-- Garde la société d’origine pour le premier dossier. Les autres conservent leur ID et leur historique.
alter table public.prospects disable trigger prospects_set_dossier_societe;
alter table public.prospects disable trigger prospects_updated_at;

with dossiers_a_separer as materialized (
  select id, societe_id, gen_random_uuid() as nouvelle_societe
  from (
    select id, societe_id, row_number() over (partition by societe_id order by created_at, id) as rang
    from public.prospects
  ) dossiers
  where rang > 1
), copies as (
  insert into public.societes (id, raison_sociale, siret, created_at, updated_at)
  select d.nouvelle_societe, s.raison_sociale, s.siret, s.created_at, s.updated_at
  from dossiers_a_separer d join public.societes s on s.id = d.societe_id
  returning id
)
update public.prospects p set societe_id = c.id
from dossiers_a_separer d join copies c on c.id = d.nouvelle_societe
where p.id = d.id;

alter table public.prospects enable trigger prospects_set_dossier_societe;
alter table public.prospects enable trigger prospects_updated_at;
alter table public.prospects
  add constraint prospects_societe_id_unique unique (societe_id),
  alter constraint prospects_societe_id_fkey deferrable initially deferred;
drop index public.prospects_societe_id_idx;

revoke execute on function public.update_societe(uuid, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.merge_societes(uuid, uuid) from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate on public.societes from service_role;

alter policy societes_select on public.societes using (
  public.account_active() and exists (select 1 from public.prospects p where p.societe_id = societes.id)
);

create or replace function public.set_dossier_societe()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if tg_op = 'INSERT' then
    if (current_user in ('anon', 'authenticated') or auth.role() in ('anon', 'authenticated'))
      and (public.current_role() in ('admin', 'telepro')
        or (public.is_regie() and new.cree_par = auth.uid())) is not true then
      raise exception using errcode = '42501', message = 'Création de dossier non autorisée.';
    end if;
    if new.societe_id is not null then
      raise exception using errcode = '22023', message = 'Chaque dossier a sa propre société.';
    end if;
    new.societe_id := gen_random_uuid();
  else
    if (current_user in ('anon', 'authenticated') or auth.role() in ('anon', 'authenticated'))
      and (public.prospect_visible(old.assigne_a, old.cree_par, old.id)
        and public.prospect_visible(new.assigne_a, new.cree_par, new.id)) is not true then
      raise exception using errcode = '42501', message = 'Modification de dossier non autorisée.';
    end if;
    if new.societe_id is distinct from old.societe_id then
      raise exception using errcode = '22023', message = 'Chaque dossier garde sa propre société.';
    end if;
  end if;

  new.raison_sociale := nullif(btrim(new.raison_sociale), '');
  if new.raison_sociale is null then
    raise exception using errcode = '22023', message = 'Saisissez une raison sociale.';
  end if;
  new.siret := nullif(btrim(new.siret), '');
  return new;
end;
$$;

-- La clé étrangère différée permet de créer la copie après la validation de la ligne.
-- Un INSERT ignoré par ON CONFLICT ne laisse donc aucune société orpheline.
create function public.synchroniser_identite_dossier()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if tg_op = 'INSERT' then
    insert into public.societes (id, raison_sociale, siret)
    values (new.societe_id, new.raison_sociale, new.siret);
  elsif tg_op = 'DELETE' then
    delete from public.societes where id = old.societe_id;
  elsif new.raison_sociale is distinct from old.raison_sociale or new.siret is distinct from old.siret then
    update public.societes
    set raison_sociale = new.raison_sociale, siret = new.siret
    where id = new.societe_id;
  end if;
  return null;
end;
$$;

revoke execute on function public.synchroniser_identite_dossier() from public, anon, authenticated, service_role;
create trigger prospects_synchroniser_identite
  after insert or delete or update of raison_sociale, siret on public.prospects
  for each row execute function public.synchroniser_identite_dossier();

create or replace function public.import_societes_correspondantes(p_nom text, p_siret text)
returns table (id uuid, raison_sociale text, siret text)
language sql stable set search_path = pg_catalog as $$
  select s.id, s.raison_sociale, s.siret
  from public.societes s join public.prospects p on p.societe_id = s.id
  where public.import_siret(s.siret) = public.import_siret(p_siret)
     or public.import_nom_societe(s.raison_sociale) = nullif(public.import_nom_societe(p_nom), '')
  order by (public.import_siret(s.siret) = public.import_siret(p_siret)) desc nulls last,
           s.raison_sociale, s.id
  limit 20
$$;

create or replace function public.import_dossier_confirmer(p_acteur uuid, p_id uuid, p_empreinte text, p_lignes jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_lot public.import_dossier_lots%rowtype;
  v_ligne jsonb;
  v_ligne_id integer;
  v_lignes_vues integer[] := '{}';
  v_dossier uuid;
  v_dossiers jsonb := '[]'::jsonb;
  v_resultat jsonb;
begin
  perform public.finance_exiger_admin(p_acteur);
  -- Vérifie les doublons entre lots même lorsque deux confirmations arrivent ensemble.
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
    if v_ligne_id is null or v_ligne_id not between 2 and 1001 or v_ligne_id = any(v_lignes_vues)
       or jsonb_typeof(v_ligne->'allow_duplicate') is distinct from 'boolean'
       or v_ligne ? 'company' or v_ligne ? 'societe_id'
       or nullif(btrim(v_ligne->>'raison_sociale'), '') is null then
      raise exception using errcode = '22023', message = 'Ligne invalide.';
    end if;

    if not (v_ligne->>'allow_duplicate')::boolean
      and exists (select 1 from public.import_societes_correspondantes(v_ligne->>'raison_sociale', v_ligne->>'siret')) then
      raise exception using errcode = '40001', message = format('Un dossier correspond à la ligne %s. Actualisez l’aperçu.', v_ligne_id);
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
      raison_sociale, siret, statut, fournisseur, energie,
      date_signature, debut_livraison, fin_livraison, assigne_a, teleprospecteur_id, cree_par
    ) values (
      v_ligne->>'raison_sociale', v_ligne->>'siret', (v_ligne->>'statut')::public.prospect_statut,
      v_ligne->>'fournisseur', v_ligne->>'energie', (v_ligne->>'date_signature')::date,
      (v_ligne->>'debut_livraison')::date, (v_ligne->>'fin_livraison')::date,
      (v_ligne->>'assigne_a')::uuid, (v_ligne->>'teleprospecteur_id')::uuid, p_acteur
    ) returning id into v_dossier;

    if v_ligne->>'commission_cents' is not null then
      perform public.finance_modifier_dossier(p_acteur, v_dossier, 'commission', jsonb_build_object(
        'commission_cents', (v_ligne->>'commission_cents')::bigint, 'repartitions', '[]'::jsonb
      ));
    end if;
    insert into public.prospect_activites(prospect_id, auteur_id, type, detail)
    values (v_dossier, p_acteur, 'creation', format('Import Excel, ligne %s', v_ligne_id));

    v_dossiers := v_dossiers || jsonb_build_array(jsonb_build_object('line', v_ligne_id, 'id', v_dossier));
    v_lignes_vues := array_append(v_lignes_vues, v_ligne_id);
  end loop;
  v_resultat := jsonb_build_object('count', jsonb_array_length(v_dossiers), 'dossiers', v_dossiers);
  insert into public.import_dossier_lots(acteur_id, id, empreinte, resultat) values (p_acteur, p_id, p_empreinte, v_resultat);
  return v_resultat;
end;
$$;
