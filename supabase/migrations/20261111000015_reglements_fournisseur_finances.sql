-- La date seule des anciennes réceptions ne suffit pas pour créer une écriture.
alter table public.prospect_reglements_fournisseur
  add column montant_recu_cents bigint check (
    montant_recu_cents is null or (montant_recu_cents between 1 and 1000000000000 and date_reception is not null)
  ),
  add unique (prospect_id, id);

-- Les écritures liées sont des encaissements réels. L'échéance contractuelle
-- reste dans le règlement, éventuellement sans date précise.
alter table public.finance_echeances
  alter column date_prevue drop not null,
  add column reglement_fournisseur_id uuid unique,
  add constraint finance_echeances_reglement_fournisseur_fk
    foreign key (prospect_id, reglement_fournisseur_id)
    references public.prospect_reglements_fournisseur (prospect_id, id) on delete restrict,
  add constraint finance_echeances_source_check check (
    (reglement_fournisseur_id is null and date_prevue is not null)
    or (reglement_fournisseur_id is not null and repartition_id is null and date_prevue is null)
  );

revoke delete on public.prospect_reglements_fournisseur from authenticated;
revoke insert (prospect_id, libelle, date_prevue, annee_prevue, montant_cents, taux_bps, date_reception, note),
       update (libelle, date_prevue, annee_prevue, montant_cents, taux_bps, date_reception, note)
  on public.prospect_reglements_fournisseur from authenticated;

-- Seule la RPC de synchronisation peut autoriser une écriture sur son règlement,
-- pendant sa transaction et sur sa connexion. Un rollback retire aussi la garde.
create table public.finance_reglements_fournisseur_garde (
  transaction_id bigint not null,
  backend_pid integer not null,
  reglement_id uuid not null,
  primary key (transaction_id, backend_pid, reglement_id)
);
alter table public.finance_reglements_fournisseur_garde enable row level security;
revoke all on public.finance_reglements_fournisseur_garde from public, anon, authenticated, service_role;

create function public.finance_proteger_reglement_fournisseur()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  v_ancien_reglement uuid;
  v_nouveau_reglement uuid;
begin
  if tg_table_name = 'finance_echeances' then
    if tg_op <> 'INSERT' then v_ancien_reglement := old.reglement_fournisseur_id; end if;
    if tg_op <> 'DELETE' then v_nouveau_reglement := new.reglement_fournisseur_id; end if;
  else
    if tg_op <> 'INSERT' then
      select reglement_fournisseur_id into v_ancien_reglement
        from public.finance_echeances where id = old.echeance_id;
    end if;
    if tg_op <> 'DELETE' then
      select reglement_fournisseur_id into v_nouveau_reglement
        from public.finance_echeances where id = new.echeance_id;
    end if;
  end if;

  if exists (
    select 1 from (values (v_ancien_reglement), (v_nouveau_reglement)) as r(id)
    where r.id is not null and not exists (
      select 1 from public.finance_reglements_fournisseur_garde g
      where g.transaction_id = txid_current_if_assigned() and g.backend_pid = pg_backend_pid()
        and g.reglement_id = r.id
    )
  ) then
    raise exception using errcode = '22023',
      message = 'Modifiez cet encaissement depuis les règlements fournisseur du dossier.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.finance_proteger_reglement_fournisseur() from public, anon, authenticated, service_role;
create trigger finance_echeances_proteger_reglement_fournisseur
  before insert or update or delete on public.finance_echeances
  for each row execute function public.finance_proteger_reglement_fournisseur();
create trigger finance_paiements_proteger_reglement_fournisseur
  before insert or update or delete on public.finance_paiements
  for each row execute function public.finance_proteger_reglement_fournisseur();

create function public.modifier_reglement_fournisseur(p_acteur uuid, p_prospect uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog as $$
declare
  v_id uuid := (p_payload->>'id')::uuid;
  v_reglement public.prospect_reglements_fournisseur;
  v_echeance public.finance_echeances;
  v_paiement uuid;
  v_montant bigint;
  v_reception date;
  v_libelle text;
  v_champs_echeance jsonb;
  v_transaction_id bigint;
  v_backend_pid integer := pg_backend_pid();
begin
  perform public.finance_exiger_admin(p_acteur);
  -- Même verrou et même ordre que finance_modifier_dossier.
  perform 1 from public.prospects where id = p_prospect for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Dossier introuvable.';
  end if;

  if v_id is not null then
    select * into v_reglement from public.prospect_reglements_fournisseur
      where id = v_id and prospect_id = p_prospect for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Règlement introuvable dans ce dossier.';
    end if;
    select * into v_echeance from public.finance_echeances where reglement_fournisseur_id = v_id;
    if v_echeance.id is not null then
      select id into strict v_paiement from public.finance_paiements where echeance_id = v_echeance.id;
    end if;
  end if;

  if p_action = 'recevoir' and v_id is not null then
    v_montant := (p_payload->>'montant_recu_cents')::bigint;
    v_reception := (p_payload->>'date_reception')::date;
    if v_montant is null or v_montant not between 1 and 1000000000000
      or v_reception is null or v_reception not between date '0001-01-01' and date '9999-12-31'
      or v_reception > timezone('Europe/Paris', now())::date then
      raise exception using errcode = '22023', message = 'Saisissez le montant reçu et une date de réception valide.';
    end if;

    if v_echeance.id is not null and v_montant = v_reglement.montant_recu_cents
      and v_reception = v_reglement.date_reception then
      return to_jsonb(v_reglement) - 'prospect_id' - 'created_at';
    end if;
  end if;

  if v_id is not null then
    v_transaction_id := txid_current();
    insert into public.finance_reglements_fournisseur_garde (transaction_id, backend_pid, reglement_id)
      values (v_transaction_id, v_backend_pid, v_id);
  end if;

  if p_action = 'enregistrer' then
    v_libelle := btrim(p_payload->>'libelle');
    if v_id is null then
      insert into public.prospect_reglements_fournisseur (
        prospect_id, libelle, date_prevue, annee_prevue, montant_cents, taux_bps, note
      ) values (
        p_prospect, v_libelle, (p_payload->>'date_prevue')::date, (p_payload->>'annee_prevue')::integer,
        (p_payload->>'montant_cents')::bigint, (p_payload->>'taux_bps')::integer, nullif(btrim(p_payload->>'note'), '')
      ) returning * into v_reglement;
    else
      update public.prospect_reglements_fournisseur set
        libelle = v_libelle, date_prevue = (p_payload->>'date_prevue')::date,
        annee_prevue = (p_payload->>'annee_prevue')::integer, montant_cents = (p_payload->>'montant_cents')::bigint,
        taux_bps = (p_payload->>'taux_bps')::integer, note = nullif(btrim(p_payload->>'note'), '')
      where id = v_id returning * into v_reglement;
      if v_echeance.id is not null and v_echeance.note is distinct from v_libelle then
        perform public.finance_modifier_dossier(p_acteur, p_prospect, 'echeance',
          jsonb_build_object('id', v_echeance.id, 'montant_cents', v_echeance.montant_cents, 'note', v_libelle));
      end if;
    end if;

  elsif p_action = 'recevoir' and v_id is not null then
    if not exists (select 1 from public.finance_commissions where prospect_id = p_prospect) then
      raise exception using errcode = '22023', message = 'Enregistrez la commission dans Finances du dossier avant de confirmer la réception.';
    end if;
    if v_montant + coalesce((
      select sum(e.montant_cents) from public.finance_echeances e
      where e.prospect_id = p_prospect and e.repartition_id is null
        and e.id is distinct from v_echeance.id
    ), 0) > (select commission_cents from public.finance_commissions where prospect_id = p_prospect) then
      raise exception using errcode = '22023', message = 'Le montant reçu et les autres échéances fournisseur dépassent la commission. Vérifiez si ce versement est déjà saisi dans Finances du dossier.';
    end if;

    v_champs_echeance := jsonb_build_object('id', v_echeance.id, 'montant_cents', v_montant, 'note', v_reglement.libelle);
    if v_echeance.id is null then
      insert into public.finance_echeances (prospect_id, montant_cents, note, reglement_fournisseur_id)
        values (p_prospect, v_montant, v_reglement.libelle, v_id) returning * into v_echeance;
      insert into public.finance_audit (acteur_id, prospect_id, action, apres)
        values (p_acteur, p_prospect, 'echeance', to_jsonb(v_echeance));
    elsif v_montant > v_echeance.montant_cents then
      perform public.finance_modifier_dossier(p_acteur, p_prospect, 'echeance', v_champs_echeance);
    end if;

    perform public.finance_modifier_dossier(p_acteur, p_prospect, 'paiement',
      jsonb_build_object('id', v_paiement, 'echeance_id', v_echeance.id, 'montant_cents', v_montant, 'date_paiement', v_reception));

    if v_montant < v_echeance.montant_cents then
      perform public.finance_modifier_dossier(p_acteur, p_prospect, 'echeance', v_champs_echeance);
    end if;
    update public.prospect_reglements_fournisseur
      set date_reception = v_reception, montant_recu_cents = v_montant
      where id = v_id returning * into v_reglement;

  elsif p_action in ('annuler_reception', 'supprimer') and v_id is not null then
    if v_echeance.id is not null then
      perform public.finance_modifier_dossier(p_acteur, p_prospect, 'supprimer_paiement', jsonb_build_object('id', v_paiement));
      perform public.finance_modifier_dossier(p_acteur, p_prospect, 'supprimer_echeance', jsonb_build_object('id', v_echeance.id));
    end if;
    if p_action = 'supprimer' then
      delete from public.prospect_reglements_fournisseur where id = v_id;
    else
      update public.prospect_reglements_fournisseur set date_reception = null, montant_recu_cents = null
        where id = v_id returning * into v_reglement;
    end if;
  else
    raise exception using errcode = '22023', message = 'Action ou identifiant de règlement invalide.';
  end if;

  if v_transaction_id is not null then
    delete from public.finance_reglements_fournisseur_garde
      where transaction_id = v_transaction_id and backend_pid = v_backend_pid and reglement_id = v_id;
  end if;
  if p_action = 'supprimer' then return jsonb_build_object('id', v_id); end if;
  return to_jsonb(v_reglement) - 'prospect_id' - 'created_at';
end;
$$;

revoke all on function public.modifier_reglement_fournisseur(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.modifier_reglement_fournisseur(uuid, uuid, text, jsonb) to service_role;
