alter table public.rdv
  add column qualification text check (qualification in ('R1','R2')),
  add column google_sync_status text not null default 'pending' check (google_sync_status in ('pending','synced','error','disconnected')),
  add column google_sync_error text,
  add column google_sync_revision integer not null default 0,
  add column google_event_generation integer not null default 0,
  add column google_sync_lock uuid,
  add column google_sync_locked_at timestamptz;
update public.rdv set google_sync_status = case when google_event_id is not null then 'synced' else 'disconnected' end;

-- All writes must pass the API's access, calendar and travel checks.
revoke insert, update, delete on public.rdv from anon, authenticated;

create function public.rdv_sync_changed() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if (new.debut,new.fin,new.lieu,new.statut,new.qualification,new.notes) is distinct from
     (old.debut,old.fin,old.lieu,old.statut,old.qualification,old.notes) then
    if old.statut = 'annule' and new.statut <> 'annule' then
      if old.google_event_id is not null then
        raise exception 'Synchronisez l’annulation Google avant de replanifier';
      end if;
      new.google_event_generation := old.google_event_generation + 1;
    end if;
    new.google_sync_revision := old.google_sync_revision + 1;
    new.google_sync_status := 'pending';
    new.google_sync_error := null;
  end if;
  return new;
end $$;
create trigger rdv_sync_changed before update on public.rdv for each row execute function public.rdv_sync_changed();

create function public.claim_rdv_sync(p_id uuid, p_lock uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.rdv set google_sync_lock = p_lock, google_sync_locked_at = now()
  where id = p_id and (google_sync_lock is null or google_sync_locked_at < now() - interval '2 minutes');
  return found;
end $$;
revoke all on function public.claim_rdv_sync(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_rdv_sync(uuid, uuid) to service_role;

create function public.rdv_advance_dossier() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.statut = 'planifie' then
    update public.prospects set statut = 'rdv_place' where id = new.prospect_id and statut = 'en_cours';
  end if;
  return new;
end $$;
create trigger rdv_advance_dossier after insert on public.rdv for each row execute function public.rdv_advance_dossier();
