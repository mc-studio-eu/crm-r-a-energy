create table public.import_dossier_lots (
  acteur_id uuid not null references public.profiles(id) on delete cascade,
  id uuid not null,
  empreinte text not null,
  resultat jsonb not null,
  cree_le timestamptz not null default now(),
  primary key (acteur_id, id)
);

alter table public.import_dossier_lots enable row level security;
revoke all on public.import_dossier_lots from public, anon, authenticated, service_role;
grant select on public.import_dossier_lots to service_role;

create function public.import_nom_societe(p_nom text)
returns text language sql immutable strict set search_path = pg_catalog as $$
  select btrim(regexp_replace(regexp_replace(lower(normalize(p_nom, NFD)), U&'[\0300-\036F]', '', 'g'), '[[:space:]_]+', ' ', 'g'))
$$;

create function public.import_siret(p_siret text)
returns text language sql immutable strict set search_path = pg_catalog as $$
  select nullif(regexp_replace(p_siret, '[^0-9]', '', 'g'), '')
$$;

create index societes_import_nom_idx on public.societes(public.import_nom_societe(raison_sociale));
create index societes_import_siret_idx on public.societes(public.import_siret(siret));

create function public.import_societes_correspondantes(p_nom text, p_siret text)
returns table (id uuid, raison_sociale text, siret text)
language sql stable set search_path = pg_catalog as $$
  select s.id, s.raison_sociale, s.siret
  from public.societes s
  where public.import_siret(s.siret) = public.import_siret(p_siret)
     or public.import_nom_societe(s.raison_sociale) = nullif(public.import_nom_societe(p_nom), '')
  order by (public.import_siret(s.siret) = public.import_siret(p_siret)) desc nulls last,
           s.raison_sociale, s.id
  limit 20
$$;

create function public.import_dossier_societes(p_acteur uuid, p_lignes jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_resultat jsonb;
begin
  perform public.finance_exiger_admin(p_acteur);
  if jsonb_typeof(p_lignes) is distinct from 'array' or jsonb_array_length(p_lignes) > 1000 then
    raise exception using errcode = '22023', message = 'Lot invalide.';
  end if;
  select coalesce(jsonb_object_agg(l.line, c.societes), '{}'::jsonb) into v_resultat
  from jsonb_to_recordset(p_lignes) as l(line integer, raison_sociale text, siret text)
  cross join lateral (
    select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) as societes
    from public.import_societes_correspondantes(l.raison_sociale, l.siret) s
  ) c;
  return v_resultat;
end;
$$;

create function public.import_dossier_confirmer(p_acteur uuid, p_id uuid, p_empreinte text, p_lignes jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_lot public.import_dossier_lots%rowtype;
  v_ligne jsonb;
  v_ref jsonb;
  v_ligne_id integer;
  v_choix text;
  v_societe uuid;
  v_dossier uuid;
  v_dossiers jsonb := '[]'::jsonb;
  v_societes jsonb := '{}'::jsonb;
  v_resultat jsonb;
begin
  perform public.finance_exiger_admin(p_acteur);
  -- Les confirmations se succèdent pour que le choix « nouvelle société » puisse être vérifié de nouveau.
  perform pg_advisory_xact_lock(hashtextextended('import_dossier_confirmer', 0));
  select * into v_lot from public.import_dossier_lots where acteur_id = p_acteur and id = p_id;
  if found then
    if v_lot.empreinte is distinct from p_empreinte then
      raise exception using errcode = '40001', message = 'Ce lot correspond à une autre sélection.';
    end if;
    return v_lot.resultat;
  end if;

  if p_id is null or p_empreinte is null or p_empreinte !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_lignes) is distinct from 'array' or jsonb_array_length(p_lignes) not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'Lot invalide.';
  end if;

  for v_ligne in select value from jsonb_array_elements(p_lignes) order by (value->>'line')::integer loop
    v_ligne_id := (v_ligne->>'line')::integer;
    v_choix := v_ligne->>'company';
    v_societe := null;
    if v_ligne_id is null or v_ligne_id not between 2 and 1001 or v_societes ? v_ligne_id::text
       or v_choix is null or nullif(btrim(v_ligne->>'raison_sociale'), '') is null then
      raise exception using errcode = '22023', message = 'Ligne invalide.';
    end if;

    if v_choix = 'new' then
      if exists (select 1 from public.import_societes_correspondantes(v_ligne->>'raison_sociale', v_ligne->>'siret')) then
        raise exception using errcode = '40001', message = format('Une société correspond à la ligne %s. Actualisez l’aperçu.', v_ligne_id);
      end if;
    elsif jsonb_typeof(v_ligne->'company') = 'number' then
      v_ref := v_societes->v_choix;
      if v_ref is null or (
        public.import_nom_societe(v_ref->>'raison_sociale') is distinct from public.import_nom_societe(v_ligne->>'raison_sociale')
        and not coalesce(public.import_siret(v_ref->>'siret') = public.import_siret(v_ligne->>'siret'), false)
      ) then
        raise exception using errcode = '40001', message = format('Vérifiez la société de la ligne %s.', v_ligne_id);
      end if;
      v_societe := (v_ref->>'id')::uuid;
    elsif v_choix <> 'new_duplicate' then
      select s.id into v_societe from public.societes s
      where s.id = v_choix::uuid
        and (
          public.import_nom_societe(s.raison_sociale) = public.import_nom_societe(v_ligne->>'raison_sociale')
          or public.import_siret(s.siret) = public.import_siret(v_ligne->>'siret')
        )
      for share;
      if not found then
        raise exception using errcode = '40001', message = format('La société de la ligne %s a changé. Actualisez l’aperçu.', v_ligne_id);
      end if;
    end if;

    if (v_ligne->>'assigne_a' is not null and not exists (
      select 1 from public.profiles where id = (v_ligne->>'assigne_a')::uuid and actif
        and role in ('commercial', 'regie_interne', 'regie_externe')
    )) or (v_ligne->>'teleprospecteur_id' is not null and not exists (
      select 1 from public.profiles where id = (v_ligne->>'teleprospecteur_id')::uuid and actif and role = 'telepro'
    )) then
      raise exception using errcode = '40001', message = format('Un intervenant de la ligne %s a changé. Actualisez l’aperçu.', v_ligne_id);
    end if;

    insert into public.prospects (
      societe_id, raison_sociale, siret, statut, fournisseur, energie,
      date_signature, debut_livraison, fin_livraison, assigne_a, teleprospecteur_id, cree_par
    ) values (
      v_societe, v_ligne->>'raison_sociale', v_ligne->>'siret', (v_ligne->>'statut')::public.prospect_statut,
      v_ligne->>'fournisseur', v_ligne->>'energie', (v_ligne->>'date_signature')::date,
      (v_ligne->>'debut_livraison')::date, (v_ligne->>'fin_livraison')::date,
      (v_ligne->>'assigne_a')::uuid, (v_ligne->>'teleprospecteur_id')::uuid, p_acteur
    ) returning id, societe_id into v_dossier, v_societe;

    if v_ligne->>'commission_cents' is not null then
      perform public.finance_modifier_dossier(p_acteur, v_dossier, 'commission', jsonb_build_object(
        'commission_cents', (v_ligne->>'commission_cents')::bigint, 'repartitions', '[]'::jsonb
      ));
    end if;
    insert into public.prospect_activites(prospect_id, auteur_id, type, detail)
    values (v_dossier, p_acteur, 'creation', format('Import Excel, ligne %s', v_ligne_id));

    v_dossiers := v_dossiers || jsonb_build_array(jsonb_build_object('line', v_ligne_id, 'id', v_dossier));
    v_societes := v_societes || jsonb_build_object(v_ligne_id, jsonb_build_object(
      'id', v_societe, 'raison_sociale', v_ligne->>'raison_sociale', 'siret', v_ligne->>'siret'
    ));
  end loop;
  v_resultat := jsonb_build_object('count', jsonb_array_length(v_dossiers), 'dossiers', v_dossiers);
  insert into public.import_dossier_lots(acteur_id, id, empreinte, resultat) values (p_acteur, p_id, p_empreinte, v_resultat);
  return v_resultat;
end;
$$;

revoke all on function public.import_nom_societe(text) from public, anon, authenticated;
revoke all on function public.import_siret(text) from public, anon, authenticated;
revoke all on function public.import_societes_correspondantes(text, text) from public, anon, authenticated, service_role;
revoke all on function public.import_dossier_societes(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.import_dossier_confirmer(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.import_dossier_societes(uuid, jsonb) to service_role;
grant execute on function public.import_dossier_confirmer(uuid, uuid, text, jsonb) to service_role;
