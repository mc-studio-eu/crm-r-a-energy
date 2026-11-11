-- Le registre financier ne fait pas partie des fiches prospects publiques.
-- Les lectures et mutations passent par des RPC réservées au serveur.
create table public.finance_beneficiaires (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (char_length(btrim(nom)) between 1 and 150),
  profil_id uuid references public.profiles(id) on delete set null,
  actif boolean not null default true
);

create index finance_beneficiaires_profil_idx on public.finance_beneficiaires(profil_id);

create table public.finance_commissions (
  prospect_id uuid primary key references public.prospects(id) on delete restrict,
  commission_cents bigint not null check (commission_cents between 0 and 1000000000000)
);

create table public.finance_repartitions (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.finance_commissions(prospect_id) on delete restrict,
  beneficiaire_id uuid not null references public.finance_beneficiaires(id) on delete restrict,
  taux_bps integer not null check (taux_bps between 0 and 10000),
  fonction text not null check (char_length(btrim(fonction)) between 1 and 80),
  montant_cents bigint not null check (montant_cents between 0 and 1000000000000),
  unique (prospect_id, beneficiaire_id),
  unique (prospect_id, id)
);

create index finance_repartitions_beneficiaire_idx on public.finance_repartitions(beneficiaire_id);

create table public.finance_echeances (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.finance_commissions(prospect_id) on delete restrict,
  -- NULL = encaissement fournisseur ; sinon reversement de cette répartition.
  repartition_id uuid,
  date_prevue date not null,
  montant_cents bigint not null check (montant_cents between 1 and 1000000000000),
  note text check (char_length(note) <= 500),
  foreign key (prospect_id, repartition_id) references public.finance_repartitions(prospect_id, id) on delete restrict
);

create index finance_echeances_prospect_idx on public.finance_echeances(prospect_id, repartition_id);
create index finance_echeances_date_idx on public.finance_echeances(date_prevue);

create table public.finance_paiements (
  id uuid primary key default gen_random_uuid(),
  echeance_id uuid not null references public.finance_echeances(id) on delete restrict,
  date_paiement date not null,
  montant_cents bigint not null check (montant_cents between 1 and 1000000000000),
  note text check (char_length(note) <= 500)
);

create index finance_paiements_echeance_idx on public.finance_paiements(echeance_id);
create index finance_paiements_date_idx on public.finance_paiements(date_paiement);

create table public.finance_audit (
  id uuid primary key default gen_random_uuid(),
  cree_le timestamptz not null default now(),
  acteur_id uuid not null,
  prospect_id uuid,
  action text not null,
  avant jsonb,
  apres jsonb
);

create index finance_audit_prospect_idx on public.finance_audit(prospect_id, cree_le desc);

alter table public.finance_beneficiaires enable row level security;
alter table public.finance_commissions enable row level security;
alter table public.finance_repartitions enable row level security;
alter table public.finance_echeances enable row level security;
alter table public.finance_paiements enable row level security;
alter table public.finance_audit enable row level security;

revoke all on public.finance_beneficiaires, public.finance_commissions, public.finance_repartitions,
  public.finance_echeances, public.finance_paiements, public.finance_audit from public, anon, authenticated, service_role;
grant select on public.finance_beneficiaires, public.finance_audit to service_role;

create function public.finance_exiger_admin(p_acteur uuid)
returns void language plpgsql stable security invoker set search_path = pg_catalog as $$
begin
  if not exists (select 1 from public.profiles p where p.id = p_acteur and p.actif and p.role = 'admin') then
    raise exception using errcode = '42501', message = 'Accès financier réservé aux administrateurs.';
  end if;
end;
$$;

create function public.finance_modifier_beneficiaire(p_acteur uuid, p_id uuid, p_action text, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_id uuid := p_id;
  v_avant jsonb;
  v_apres jsonb;
begin
  perform public.finance_exiger_admin(p_acteur);
  if p_id is not null then
    select to_jsonb(b) into v_avant from public.finance_beneficiaires b where b.id = p_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Bénéficiaire introuvable.';
    end if;
  end if;

  if p_action = 'enregistrer' then
    if p_id is null then
      insert into public.finance_beneficiaires (nom, profil_id, actif)
      values (btrim(p_payload->>'nom'), (p_payload->>'profil_id')::uuid, (p_payload->>'actif')::boolean)
      returning id into v_id;
    else
      update public.finance_beneficiaires
        set nom = btrim(p_payload->>'nom'), profil_id = (p_payload->>'profil_id')::uuid, actif = (p_payload->>'actif')::boolean
        where id = p_id;
    end if;
    select to_jsonb(b) into v_apres from public.finance_beneficiaires b where b.id = v_id;
  elsif p_action = 'supprimer' and p_id is not null then
    if exists (select 1 from public.finance_repartitions where beneficiaire_id = p_id) then
      raise exception using errcode = '22023', message = 'Ce bénéficiaire est rattaché à un dossier. Vous pouvez le désactiver.';
    end if;
    delete from public.finance_beneficiaires where id = p_id;
  else
    raise exception using errcode = '22023', message = 'Action inconnue.';
  end if;

  insert into public.finance_audit (acteur_id, action, avant, apres)
    values (p_acteur, 'beneficiaire_' || p_action, v_avant, v_apres);
  return v_id;
end;
$$;

create function public.finance_modifier_dossier(p_acteur uuid, p_prospect uuid, p_action text, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_id uuid := (p_payload->>'id')::uuid;
  v_echeance uuid;
  v_avant jsonb;
  v_apres jsonb;
  v_base bigint;
  v_taux bigint;
  v_parts jsonb;
  v_part_count integer;
  v_benef_count integer;
begin
  perform public.finance_exiger_admin(p_acteur);
  -- Même verrou pour tous les mouvements, même avant la création de la commission.
  -- FOR UPDATE protège aussi contre la suppression concurrente de la fiche.
  perform 1 from public.prospects where id = p_prospect for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Dossier introuvable.';
  end if;

  -- Crée une nouvelle version de la ligne, y compris pour les mouvements.
  -- En isolation repeatable read, un concurrent avec un instantané ancien
  -- échoue plutôt que de valider ses agrégats sur des montants périmés.
  update public.finance_commissions set commission_cents = commission_cents where prospect_id = p_prospect;

  if p_action = 'commission' then
    v_base := (p_payload->>'commission_cents')::bigint;
    v_parts := p_payload->'repartitions';
    if v_base is null or v_base not between 0 and 1000000000000
       or jsonb_typeof(v_parts) is distinct from 'array'
       or (case when jsonb_typeof(v_parts) = 'array' then jsonb_array_length(v_parts) > 2 else false end) then
      raise exception using errcode = '22023', message = 'Saisissez une commission valide et deux bénéficiaires au maximum.';
    end if;

    select coalesce(sum(r.taux_bps), 0), count(*), count(distinct r.beneficiaire_id)
      into v_taux, v_part_count, v_benef_count
      from jsonb_to_recordset(v_parts) as r(beneficiaire_id uuid, taux_bps integer);
    if v_part_count <> v_benef_count or v_taux > 10000 or exists (
      select 1 from jsonb_to_recordset(v_parts) as r(beneficiaire_id uuid, taux_bps integer, fonction text)
      where r.taux_bps is null or r.taux_bps not between 0 and 10000 or char_length(btrim(r.fonction)) > 80
    ) then
      raise exception using errcode = '22023', message = 'Choisissez des bénéficiaires distincts et un total de pourcentages inférieur ou égal à 100 %.';
    end if;

    -- La désactivation/suppression d'un bénéficiaire et l'ajout d'une part
    -- se synchronisent sur sa ligne. Une part historique reste utilisable.
    perform 1
      from public.finance_beneficiaires b
      join jsonb_to_recordset(v_parts) as r(beneficiaire_id uuid) on b.id = r.beneficiaire_id
      order by b.id for share of b;
    if exists (
      select 1 from jsonb_to_recordset(v_parts) as r(beneficiaire_id uuid)
      where not exists (select 1 from public.finance_beneficiaires b where b.id = r.beneficiaire_id and b.actif)
        and not exists (
          select 1 from public.finance_repartitions s where s.prospect_id = p_prospect and s.beneficiaire_id = r.beneficiaire_id
        )
    ) then
      raise exception using errcode = '22023', message = 'Un bénéficiaire est introuvable ou désactivé.';
    end if;

    if exists (
      select 1 from public.finance_repartitions r
      join public.finance_echeances e on e.repartition_id = r.id
      where r.prospect_id = p_prospect
        and not exists (select 1 from jsonb_to_recordset(v_parts) as s(beneficiaire_id uuid) where s.beneficiaire_id = r.beneficiaire_id)
    ) then
      raise exception using errcode = '22023', message = 'Retirez les échéances du bénéficiaire avant de supprimer sa répartition.';
    end if;

    select jsonb_build_object('commission_cents', c.commission_cents, 'repartitions',
      coalesce((select jsonb_agg(to_jsonb(r) order by r.beneficiaire_id)
        from public.finance_repartitions r where r.prospect_id = p_prospect), '[]'::jsonb))
      into v_avant from public.finance_commissions c where c.prospect_id = p_prospect;

    insert into public.finance_commissions (prospect_id, commission_cents) values (p_prospect, v_base)
      on conflict (prospect_id) do update set commission_cents = excluded.commission_cents;

    delete from public.finance_repartitions r where r.prospect_id = p_prospect and not exists (
      select 1 from jsonb_to_recordset(v_parts) as s(beneficiaire_id uuid) where s.beneficiaire_id = r.beneficiaire_id
    );

    -- Plus forts restes : le total arrondi des parts reste exact au centime,
    -- même si arrondir séparément ferait dépasser la commission.
    with calculs as (
      select beneficiaire_id, taux_bps, coalesce(nullif(btrim(fonction), ''), 'Apporteur') as fonction,
        (v_base * taux_bps) / 10000 as plancher,
        row_number() over (order by (v_base * taux_bps) % 10000 desc, beneficiaire_id) as rang
      from jsonb_to_recordset(v_parts) as r(beneficiaire_id uuid, taux_bps integer, fonction text)
    )
    insert into public.finance_repartitions (prospect_id, beneficiaire_id, taux_bps, fonction, montant_cents)
      select p_prospect, beneficiaire_id, taux_bps, fonction, plancher
        + case when rang <= (v_base * v_taux + 5000) / 10000 - sum(plancher) over () then 1 else 0 end
      from calculs
      on conflict (prospect_id, beneficiaire_id) do update
        set taux_bps = excluded.taux_bps, fonction = excluded.fonction, montant_cents = excluded.montant_cents;

    select jsonb_build_object('commission_cents', c.commission_cents, 'repartitions',
      coalesce((select jsonb_agg(to_jsonb(r) order by r.beneficiaire_id)
        from public.finance_repartitions r where r.prospect_id = p_prospect), '[]'::jsonb))
      into v_apres from public.finance_commissions c where c.prospect_id = p_prospect;
    v_id := p_prospect;

  elsif p_action in ('echeance', 'supprimer_echeance') then
    if v_id is not null then
      select to_jsonb(e) into v_avant from public.finance_echeances e where e.id = v_id and e.prospect_id = p_prospect;
      if not found then
        raise exception using errcode = 'P0002', message = 'Échéance introuvable.';
      end if;
    end if;
    if p_action = 'supprimer_echeance' and v_id is not null then
      if exists (select 1 from public.finance_paiements where echeance_id = v_id) then
        raise exception using errcode = '22023', message = 'Corrigez les paiements associés avant de supprimer cette échéance.';
      end if;
      delete from public.finance_echeances where id = v_id;
    elsif p_action = 'echeance' then
      if not exists (select 1 from public.finance_commissions where prospect_id = p_prospect) then
        raise exception using errcode = '22023', message = 'Enregistrez la commission avant de créer une échéance.';
      end if;
      if v_id is null then
        insert into public.finance_echeances (prospect_id, repartition_id, date_prevue, montant_cents, note)
          values (p_prospect, (p_payload->>'repartition_id')::uuid, (p_payload->>'date_prevue')::date,
            (p_payload->>'montant_cents')::bigint, nullif(btrim(p_payload->>'note'), ''))
          returning id into v_id;
      else
        update public.finance_echeances
          set date_prevue = (p_payload->>'date_prevue')::date, montant_cents = (p_payload->>'montant_cents')::bigint,
            note = nullif(btrim(p_payload->>'note'), '')
          where id = v_id;
      end if;
      select to_jsonb(e) into v_apres from public.finance_echeances e where e.id = v_id;
    else
      raise exception using errcode = '22023', message = 'Identifiant d’échéance manquant.';
    end if;

  elsif p_action in ('paiement', 'supprimer_paiement') then
    if v_id is not null then
      select to_jsonb(p), p.echeance_id into v_avant, v_echeance from public.finance_paiements p
        join public.finance_echeances e on e.id = p.echeance_id
        where p.id = v_id and e.prospect_id = p_prospect;
      if not found then
        raise exception using errcode = 'P0002', message = 'Paiement introuvable.';
      end if;
    end if;
    if p_action = 'supprimer_paiement' and v_id is not null then
      delete from public.finance_paiements where id = v_id;
    elsif p_action = 'paiement' then
      if v_id is null then
        select id into v_echeance from public.finance_echeances
          where id = (p_payload->>'echeance_id')::uuid and prospect_id = p_prospect;
        if not found then
          raise exception using errcode = 'P0002', message = 'Échéance introuvable.';
        end if;
        insert into public.finance_paiements (echeance_id, date_paiement, montant_cents, note)
          values (v_echeance, (p_payload->>'date_paiement')::date, (p_payload->>'montant_cents')::bigint, nullif(btrim(p_payload->>'note'), ''))
          returning id into v_id;
      else
        update public.finance_paiements
          set date_paiement = (p_payload->>'date_paiement')::date, montant_cents = (p_payload->>'montant_cents')::bigint,
            note = nullif(btrim(p_payload->>'note'), '')
          where id = v_id;
      end if;
      select to_jsonb(p) into v_apres from public.finance_paiements p where p.id = v_id;
    else
      raise exception using errcode = '22023', message = 'Identifiant de paiement manquant.';
    end if;

  else
    raise exception using errcode = '22023', message = 'Action financière inconnue.';
  end if;

  if exists (
    select 1 from public.finance_echeances e join public.finance_paiements p on p.echeance_id = e.id
    where e.prospect_id = p_prospect group by e.id having sum(p.montant_cents) > e.montant_cents
  ) then
    raise exception using errcode = '22023', message = 'Le total payé dépasse le montant de l’échéance.';
  end if;

  if exists (
    select 1 from public.finance_echeances e
      join public.finance_commissions c on c.prospect_id = e.prospect_id
      left join public.finance_repartitions r on r.id = e.repartition_id
    where e.prospect_id = p_prospect group by e.repartition_id, r.montant_cents, c.commission_cents
    having sum(e.montant_cents) > coalesce(r.montant_cents, c.commission_cents)
  ) then
    raise exception using errcode = '22023', message = 'Les échéances dépassent la commission ou la part disponible. Ajustez les échéances d’abord.';
  end if;

  insert into public.finance_audit (acteur_id, prospect_id, action, avant, apres)
    values (p_acteur, p_prospect, p_action, v_avant, v_apres);
  return v_id;
end;
$$;

create function public.finance_lire_dossier(p_acteur uuid, p_prospect uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
begin
  perform public.finance_exiger_admin(p_acteur);
  if not exists (select 1 from public.prospects where id = p_prospect) then
    raise exception using errcode = 'P0002', message = 'Dossier introuvable.';
  end if;
  return jsonb_build_object(
    'commission_cents', (select commission_cents from public.finance_commissions where prospect_id = p_prospect),
    'repartitions', coalesce((
      select jsonb_agg(to_jsonb(r) || jsonb_build_object('beneficiaire', b.nom) order by b.nom, b.id)
      from public.finance_repartitions r join public.finance_beneficiaires b on b.id = r.beneficiaire_id
      where r.prospect_id = p_prospect
    ), '[]'::jsonb),
    'echeances', coalesce((
      select jsonb_agg(to_jsonb(e) || jsonb_build_object('paiements', coalesce((
        select jsonb_agg(to_jsonb(p) order by p.date_paiement, p.id)
        from public.finance_paiements p where p.echeance_id = e.id
      ), '[]'::jsonb)) order by e.date_prevue, e.id)
      from public.finance_echeances e where e.prospect_id = p_prospect
    ), '[]'::jsonb)
  );
end;
$$;

create function public.finance_tableau(
  p_acteur uuid, p_annee integer, p_mois integer, p_societe uuid, p_fournisseur text,
  p_energie text, p_beneficiaire uuid, p_type text, p_page integer,
  p_commercial uuid default null, p_dossiers_page integer default 1
)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
declare
  v_admin boolean;
  v_debut date;
  v_fin date;
  v_aujourdhui date := timezone('Europe/Paris', now())::date;
begin
  select p.role = 'admin' into v_admin from public.profiles p
    where p.id = p_acteur and p.actif
      and p.role in ('admin', 'commercial', 'regie_interne', 'regie_externe', 'apporteur_externe');
  if not found then
    raise exception using errcode = '42501', message = 'Compte désactivé.';
  end if;
  if p_annee is null or p_annee not between 1900 and 2200
     or (p_mois is not null and p_mois not between 1 and 12)
     or p_page is null or p_page not between 1 and 1000000
     or p_dossiers_page is null or p_dossiers_page not between 1 and 1000000 then
    raise exception using errcode = '22023', message = 'Période ou page invalide.';
  end if;
  v_debut := make_date(p_annee, coalesce(p_mois, 1), 1);
  v_fin := v_debut + case when p_mois is null then interval '1 year' else interval '1 month' end;

  return (
    with dossiers as (
      select p.id as prospect_id, p.raison_sociale as dossier, s.raison_sociale as societe,
        p.fournisseur, p.energie, p.date_signature, p.debut_livraison, p.fin_livraison,
        p.statut = 'signe' as signe
      from public.prospects p join public.societes s on s.id = p.societe_id
      where (p_societe is null or p.societe_id = p_societe)
        and (p_fournisseur is null or p.fournisseur = p_fournisseur)
        and (p_energie is null or p.energie = p_energie)
        and (not v_admin or p_commercial is null or p.assigne_a = p_commercial)
        and (v_admin or p.statut = 'signe')
    ), parts as (
      select r.id, r.prospect_id, r.montant_cents, r.fonction, b.nom as beneficiaire
      from public.finance_repartitions r join public.finance_beneficiaires b on b.id = r.beneficiaire_id
      join dossiers d on d.prospect_id = r.prospect_id
      where (v_admin or b.profil_id = p_acteur)
        and (not v_admin or p_beneficiaire is null or b.id = p_beneficiaire)
    ), evenements as (
      select d.prospect_id as id, d.prospect_id, 'signature' as type, d.date_signature as date,
        c.commission_cents as montant_cents, null::text as beneficiaire
      from dossiers d left join public.finance_commissions c on c.prospect_id = d.prospect_id
      where v_admin and p_beneficiaire is null and d.signe
        and d.date_signature >= v_debut and d.date_signature < v_fin
      union all
      select d.prospect_id, d.prospect_id, 'part_ra', d.date_signature,
        c.commission_cents - coalesce((
          select sum(r.montant_cents)::bigint from parts r where r.prospect_id = d.prospect_id
        ), 0), null::text
      from dossiers d join public.finance_commissions c on c.prospect_id = d.prospect_id
      where v_admin and p_beneficiaire is null and d.signe
        and d.date_signature >= v_debut and d.date_signature < v_fin
      union all
      select r.id, r.prospect_id, 'part_signee', d.date_signature, r.montant_cents, r.beneficiaire
      from parts r join dossiers d on d.prospect_id = r.prospect_id
      where d.signe and d.date_signature >= v_debut and d.date_signature < v_fin
      union all
      select e.id, e.prospect_id, case when e.repartition_id is null then 'entree_prevue' else 'sortie_prevue' end,
        e.date_prevue, e.montant_cents, r.beneficiaire
      from public.finance_echeances e join dossiers d on d.prospect_id = e.prospect_id
      left join parts r on r.id = e.repartition_id
      where (r.id is not null or (v_admin and p_beneficiaire is null and e.repartition_id is null))
        and e.date_prevue >= v_debut and e.date_prevue < v_fin
      union all
      select p.id, e.prospect_id, case when e.repartition_id is null then 'entree_reelle' else 'sortie_reelle' end,
        p.date_paiement, p.montant_cents, r.beneficiaire
      from public.finance_paiements p join public.finance_echeances e on e.id = p.echeance_id
      join dossiers d on d.prospect_id = e.prospect_id left join parts r on r.id = e.repartition_id
      where (r.id is not null or (v_admin and p_beneficiaire is null and e.repartition_id is null))
        and p.date_paiement >= v_debut and p.date_paiement < v_fin
    ), personnels as (
      select r.prospect_id, d.dossier, d.societe, d.fournisseur, d.energie, d.date_signature, d.debut_livraison, d.fin_livraison,
        sum(r.montant_cents)::bigint as montant_cents,
        coalesce(sum(f.paye), 0)::bigint as paye_cents,
        (sum(r.montant_cents) - coalesce(sum(f.paye), 0))::bigint as reste_cents,
        min(f.prochaine_echeance) as prochaine_echeance,
        coalesce(sum(f.en_retard), 0)::bigint as retard_cents
      from parts r join dossiers d on d.prospect_id = r.prospect_id
      left join lateral (
        select sum(flux.paye) as paye,
          sum(e.montant_cents - coalesce(flux.paye, 0)) filter (where e.date_prevue < v_aujourdhui) as en_retard,
          min(e.date_prevue) filter (where coalesce(flux.paye, 0) < e.montant_cents) as prochaine_echeance
        from public.finance_echeances e
        left join lateral (select sum(p.montant_cents) as paye from public.finance_paiements p where p.echeance_id = e.id) flux on true
        where e.repartition_id = r.id and e.prospect_id = r.prospect_id
      ) f on true
      where not v_admin
      group by r.prospect_id, d.dossier, d.societe, d.fournisseur, d.energie, d.date_signature, d.debut_livraison, d.fin_livraison
    ), retards_admin as (
      select e.repartition_id is null as encaissement,
        sum(e.montant_cents - coalesce(flux.paye, 0))::text as montant_cents
      from public.finance_echeances e join dossiers d on d.prospect_id = e.prospect_id
      left join parts r on r.id = e.repartition_id
      left join lateral (select sum(p.montant_cents) as paye from public.finance_paiements p where p.echeance_id = e.id) flux on true
      where v_admin and e.date_prevue < v_aujourdhui
        and (r.id is not null or (p_beneficiaire is null and e.repartition_id is null))
      group by 1
    ), incomplets as (
      select d.prospect_id, d.dossier, d.date_signature is null as sans_date, c.prospect_id is null as sans_commission
      from dossiers d left join public.finance_commissions c on c.prospect_id = d.prospect_id
      where v_admin and d.signe
        and (p_beneficiaire is null or exists (select 1 from parts r where r.prospect_id = d.prospect_id))
        and (d.date_signature is null or (d.date_signature >= v_debut and d.date_signature < v_fin))
        and (d.date_signature is null or c.prospect_id is null)
    ), lignes as (
      select e.*, d.dossier, d.societe, d.fournisseur, d.energie, d.date_signature, d.debut_livraison, d.fin_livraison
      from evenements e join dossiers d on d.prospect_id = e.prospect_id
      where p_type is null or e.type = p_type
      order by e.date desc, e.type, e.id offset (p_page - 1) * 75 limit 75
    ), mois as (
      select extract(month from date)::integer as mois, type, count(*) as nombre, sum(montant_cents)::text as montant_cents
      from evenements group by 1, 2
    )
    select jsonb_build_object(
      'lignes', coalesce((select jsonb_agg(to_jsonb(l) order by l.date desc, l.type, l.id) from lignes l), '[]'::jsonb),
      'mois', coalesce((select jsonb_agg(to_jsonb(m) order by m.mois, m.type) from mois m), '[]'::jsonb),
      'total', (select count(*) from evenements e where p_type is null or e.type = p_type),
      'dossiers', coalesce((
        select jsonb_agg(to_jsonb(d) order by d.date_signature desc nulls last, d.prospect_id)
        from (
          select * from personnels order by date_signature desc nulls last, prospect_id
          offset (p_dossiers_page - 1) * 75 limit 75
        ) d
      ), '[]'::jsonb),
      'total_dossiers', (select count(*) from personnels),
      'bilan_personnel', case when not v_admin then (
        select jsonb_build_object('paye_cents', coalesce(sum(paye_cents), 0)::text, 'reste_cents', coalesce(sum(reste_cents), 0)::text,
          'prochaine_echeance', min(prochaine_echeance), 'retard_cents', coalesce(sum(retard_cents), 0)::text)
        from personnels
      ) else null end,
      'retards_admin', case when v_admin then jsonb_build_object(
        'encaissement_cents', coalesce((select montant_cents from retards_admin where encaissement), '0'),
        'reversement_cents', coalesce((select montant_cents from retards_admin where not encaissement), '0')
      ) else null end,
      'incomplets', coalesce((select jsonb_agg(to_jsonb(i) order by i.dossier, i.prospect_id)
        from (select * from incomplets order by dossier, prospect_id limit 20) i), '[]'::jsonb),
      'total_incomplets', (select count(*) from incomplets)
    )
  );
end;
$$;

revoke all on function public.finance_exiger_admin(uuid) from public, anon, authenticated, service_role;
revoke all on function public.finance_modifier_beneficiaire(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.finance_modifier_dossier(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.finance_lire_dossier(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.finance_tableau(uuid, integer, integer, uuid, text, text, uuid, text, integer, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.finance_modifier_beneficiaire(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.finance_modifier_dossier(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.finance_lire_dossier(uuid, uuid) to service_role;
grant execute on function public.finance_tableau(uuid, integer, integer, uuid, text, text, uuid, text, integer, uuid, integer) to service_role;
