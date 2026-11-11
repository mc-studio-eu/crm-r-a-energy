-- Credentials never belong in a client-readable directory.
create table public.google_credentials (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  refresh_token text not null
);
alter table public.google_credentials enable row level security;
revoke all on public.google_credentials from public, anon, authenticated;
grant all on public.google_credentials to service_role;
insert into public.google_credentials(profile_id, refresh_token)
select id, google_refresh_token from public.profiles where google_refresh_token is not null;
alter table public.profiles drop column google_refresh_token;

revoke update on public.profiles from public, anon, authenticated;
grant update(nom, telephone, adresse_depart, depart_lat, depart_lng) on public.profiles to authenticated;

-- The external portal does not grant access to the internal directory or old appointments.
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (public.current_role() <> 'apporteur_externe' or id = auth.uid());
drop policy rdv_select on public.rdv;
create policy rdv_select on public.rdv for select to authenticated
using (public.current_role() <> 'apporteur_externe' and (public.is_staff() or commercial_id = auth.uid()));
drop policy activites_insert on public.prospect_activites;
create policy activites_insert on public.prospect_activites for insert to authenticated
with check (
  auteur_id = auth.uid() and public.current_role() <> 'apporteur_externe'
  and exists(select 1 from public.prospects p where p.id = prospect_id)
);

create or replace function public.current_role()
returns public.user_role language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where id = auth.uid() and actif
$$;
create or replace function public.account_active()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.profiles where id = auth.uid() and actif)
$$;
revoke all on function public.account_active() from public, anon;
grant execute on function public.account_active() to authenticated, service_role;

-- Metadata is user-editable: privileged roles are assigned only by the admin API.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles(id, nom, role)
  values(new.id, coalesce(new.raw_user_meta_data ->> 'nom', new.email), 'commercial');
  return new;
end $$;

-- Restrictive policies also cover creator/owner policies that don't call current_role.
do $$ declare t text; begin
  foreach t in array array['profiles','prospects','rdv','prospect_activites','prospect_documents','app_settings'] loop
    execute format('create policy active_account on public.%I as restrictive for all to authenticated using (public.account_active()) with check (public.account_active())', t);
  end loop;
end $$;
create policy active_crm_storage on storage.objects as restrictive for all to authenticated
using (bucket_id <> 'prospect-documents' or public.account_active())
with check (bucket_id <> 'prospect-documents' or public.account_active());

-- Fix function resolution in existing SECURITY DEFINER helpers.
alter function public.is_staff() set search_path = public, pg_temp;
alter function public.is_regie() set search_path = public, pg_temp;
alter function public.prospect_visible(uuid, uuid, uuid) set search_path = public, pg_temp;
