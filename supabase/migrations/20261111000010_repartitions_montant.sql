-- Conserve la saisie d’origine pour recalculer le champ dérivé quand la commission change.
alter table public.finance_repartitions
  add column saisie_montant boolean not null default false;

create or replace function public.finance_modifier_dossier(p_acteur uuid, p_prospect uuid, p_action text, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_id uuid := (p_payload->>'id')::uuid;
  v_echeance uuid;
  v_avant jsonb;
  v_apres jsonb;
  v_base bigint;
  v_taux bigint;
  v_montants_fixes numeric;
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

    select coalesce(sum(r.taux_bps), 0), coalesce(sum(r.montant_cents), 0), count(*), count(distinct r.beneficiaire_id)
      into v_taux, v_montants_fixes, v_part_count, v_benef_count
      from jsonb_to_recordset(v_parts) as r(beneficiaire_id uuid, taux_bps integer, montant_cents bigint);
    if v_part_count <> v_benef_count or v_taux > 10000 or exists (
      select 1 from jsonb_to_recordset(v_parts) as r(taux_bps integer, montant_cents bigint, fonction text)
      where (r.taux_bps is null) = (r.montant_cents is null)
        or r.taux_bps not between 0 and 10000 or r.montant_cents not between 0 and 1000000000000
        or char_length(btrim(r.fonction)) > 80
    ) then
      raise exception using errcode = '22023', message = 'Choisissez des bénéficiaires distincts et saisissez pour chacun un montant ou un pourcentage, sans dépasser 100 % de pourcentages saisis.';
    end if;
    if v_montants_fixes + (v_base * v_taux + 5000) / 10000 > v_base then
      raise exception using errcode = '22023', message = 'La somme des montants des bénéficiaires ne peut pas dépasser la commission totale.';
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

    -- Les montants saisis restent exacts. Seules les parts saisies en pourcentage
    -- sont réparties par plus forts restes pour atteindre leur total arrondi.
    with calculs as (
      select beneficiaire_id, taux_bps, montant_cents as montant_fixe,
        coalesce(nullif(btrim(fonction), ''), 'Apporteur') as fonction,
        (v_base * taux_bps) / 10000 as plancher,
        row_number() over (partition by montant_cents is null order by (v_base * taux_bps) % 10000 desc, beneficiaire_id) as rang
      from jsonb_to_recordset(v_parts) as r(beneficiaire_id uuid, taux_bps integer, montant_cents bigint, fonction text)
    )
    insert into public.finance_repartitions (prospect_id, beneficiaire_id, taux_bps, fonction, montant_cents, saisie_montant)
      select p_prospect, beneficiaire_id,
        coalesce(taux_bps, ((montant_fixe * 10000 + v_base / 2) / nullif(v_base, 0))::integer, 0), fonction,
        coalesce(montant_fixe, plancher
          + case when rang <= (v_base * v_taux + 5000) / 10000 - sum(plancher) over () then 1 else 0 end),
        montant_fixe is not null
      from calculs
      on conflict (prospect_id, beneficiaire_id) do update
        set taux_bps = excluded.taux_bps, fonction = excluded.fonction,
          montant_cents = excluded.montant_cents, saisie_montant = excluded.saisie_montant;

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
