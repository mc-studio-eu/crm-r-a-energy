-- Le bénéficiaire interne est identifié explicitement et conserve son ID et ses
-- répartitions. L'association à un bénéficiaire existant se fait par son UUID.
alter table public.finance_beneficiaires
  add column est_ra_energy boolean not null default false,
  add constraint finance_beneficiaires_ra_sans_profil check (not est_ra_energy or profil_id is null);

create unique index finance_beneficiaires_un_seul_ra_energy
  on public.finance_beneficiaires (est_ra_energy) where est_ra_energy;

create or replace function public.finance_modifier_beneficiaire(p_acteur uuid, p_id uuid, p_action text, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_id uuid := p_id;
  v_avant jsonb;
  v_interne boolean;
  v_apres jsonb;
begin
  perform public.finance_exiger_admin(p_acteur);
  if p_id is not null then
    select to_jsonb(b), b.est_ra_energy into v_avant, v_interne
      from public.finance_beneficiaires b where b.id = p_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Bénéficiaire introuvable.';
    end if;
  end if;

  if p_action = 'enregistrer' then
    if v_interne and p_payload->>'profil_id' is not null then
      raise exception using errcode = '22023', message = 'La part R&A Energy ne peut pas être liée à un compte personnel.';
    end if;
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
    if v_interne then
      raise exception using errcode = '22023', message = 'Le bénéficiaire interne R&A Energy ne peut pas être supprimé.';
    end if;
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

-- Les anciennes écritures restent consultables et corrigibles dans le dossier.
-- Une part conservée par R&A Energy ne crée ni échéance ni paiement de reversement.
create function public.finance_refuser_reversement_interne()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare
  v_prospect_id uuid;
  v_repartition_id uuid;
  v_interne boolean;
begin
  if tg_table_name = 'finance_echeances' then
    if tg_op = 'UPDATE' then
      if (new.prospect_id, new.repartition_id) is not distinct from (old.prospect_id, old.repartition_id) then return new; end if;
    end if;
    v_prospect_id := new.prospect_id;
    v_repartition_id := new.repartition_id;
  else
    if tg_op = 'UPDATE' then
      if new.echeance_id is not distinct from old.echeance_id then return new; end if;
    end if;
    select prospect_id, repartition_id into v_prospect_id, v_repartition_id
      from public.finance_echeances where id = new.echeance_id;
  end if;

  if v_repartition_id is not null then
    select b.est_ra_energy into v_interne
      from public.finance_repartitions r join public.finance_beneficiaires b on b.id = r.beneficiaire_id
      where r.id = v_repartition_id and r.prospect_id = v_prospect_id
      for share of b;
    if v_interne then
      raise exception using errcode = '22023', message = 'La part R&A Energy ne fait pas l’objet d’un reversement.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.finance_refuser_reversement_interne() from public, anon, authenticated, service_role;

create trigger finance_echeances_refuser_reversement_interne
  before insert or update of prospect_id, repartition_id on public.finance_echeances
  for each row execute function public.finance_refuser_reversement_interne();

create trigger finance_paiements_refuser_reversement_interne
  before insert or update of echeance_id on public.finance_paiements
  for each row execute function public.finance_refuser_reversement_interne();

create or replace function public.finance_lire_dossier(p_acteur uuid, p_prospect uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
begin
  perform public.finance_exiger_admin(p_acteur);
  if not exists (select 1 from public.prospects where id = p_prospect) then
    raise exception using errcode = 'P0002', message = 'Dossier introuvable.';
  end if;
  return jsonb_build_object(
    'commission_cents', (select commission_cents from public.finance_commissions where prospect_id = p_prospect),
    'part_ra_cents', (select c.commission_cents - coalesce((
      select sum(r.montant_cents)::bigint
      from public.finance_repartitions r join public.finance_beneficiaires b on b.id = r.beneficiaire_id
      where r.prospect_id = p_prospect and not b.est_ra_energy
    ), 0) from public.finance_commissions c where c.prospect_id = p_prospect),
    'repartitions', coalesce((
      select jsonb_agg(to_jsonb(r) || jsonb_build_object('beneficiaire', b.nom, 'est_ra_energy', b.est_ra_energy)
        order by b.nom, b.id)
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

create or replace function public.finance_tableau(
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
      -- La part interne reste dans la commission fournisseur. Elle ne génère
      -- ni part bénéficiaire personnelle ni reversement.
      where not b.est_ra_energy
        and (v_admin or b.profil_id = p_acteur)
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
