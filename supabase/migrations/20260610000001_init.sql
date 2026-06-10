-- =============================================================
-- CRM R&A Energy — Schéma v1 (ticket 03)
-- Tables : profiles, prospects, rdv, prospect_activites, app_settings
-- Sécurité : RLS par rôle (admin / telepro / commercial)
-- =============================================================

-- ---------- Enums ----------
create type user_role as enum ('admin', 'telepro', 'commercial');

create type prospect_statut as enum (
  'nouveau',
  'a_rappeler',
  'rdv_place',
  'signe',
  'perdu'
);

create type rdv_statut as enum ('planifie', 'honore', 'annule', 'no_show');

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role user_role not null default 'commercial',
  nom text not null default '',
  telephone text,
  -- Adresse de départ du commercial (calcul d'itinéraire, ticket 08)
  adresse_depart text,
  depart_lat double precision,
  depart_lng double precision,
  actif boolean not null default true,
  -- Google Calendar OAuth (ticket 07) — lisible uniquement via service role
  google_refresh_token text,
  google_calendar_connected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- prospects ----------
create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  raison_sociale text not null,
  siret text,
  contact_nom text,
  telephone text,
  email text,
  adresse text,
  code_postal text,
  ville text,
  lat double precision,
  lng double precision,
  statut prospect_statut not null default 'nouveau',
  source text,
  notes text,
  assigne_a uuid references public.profiles (id),
  cree_par uuid references public.profiles (id),
  archive boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index prospects_statut_idx on public.prospects (statut);
create index prospects_assigne_a_idx on public.prospects (assigne_a);
create index prospects_ville_idx on public.prospects (ville);

-- ---------- rdv ----------
create table public.rdv (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  commercial_id uuid not null references public.profiles (id),
  debut timestamptz not null,
  fin timestamptz not null,
  lieu text,
  lieu_lat double precision,
  lieu_lng double precision,
  statut rdv_statut not null default 'planifie',
  google_event_id text,
  temps_trajet_min integer,
  notes text,
  cree_par uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rdv_fin_apres_debut check (fin > debut)
);

create index rdv_commercial_debut_idx on public.rdv (commercial_id, debut);
create index rdv_prospect_idx on public.rdv (prospect_id);

-- ---------- prospect_activites (historique) ----------
create table public.prospect_activites (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  auteur_id uuid references public.profiles (id),
  type text not null, -- 'statut' | 'note' | 'creation' | 'rdv' | 'modification'
  ancien_statut prospect_statut,
  nouveau_statut prospect_statut,
  detail text,
  created_at timestamptz not null default now()
);

create index prospect_activites_prospect_idx
  on public.prospect_activites (prospect_id, created_at desc);

-- ---------- app_settings (marge trajet paramétrable, ticket 08) ----------
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value)
values ('marge_trajet_min', '15'::jsonb);

-- ---------- updated_at automatique ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger prospects_updated_at before update on public.prospects
  for each row execute function public.set_updated_at();
create trigger rdv_updated_at before update on public.rdv
  for each row execute function public.set_updated_at();

-- ---------- Historisation automatique des changements de statut ----------
create or replace function public.log_prospect_statut()
returns trigger language plpgsql security definer as $$
begin
  if old.statut is distinct from new.statut then
    insert into public.prospect_activites
      (prospect_id, auteur_id, type, ancien_statut, nouveau_statut)
    values (new.id, auth.uid(), 'statut', old.statut, new.statut);
  end if;
  return new;
end $$;

create trigger prospects_log_statut after update on public.prospects
  for each row execute function public.log_prospect_statut();

-- ---------- Profil auto à la création d'un user (invitation admin) ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, nom, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nom', new.email),
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'commercial')
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================
-- RLS
-- Règles : admin et telepro voient tout ;
-- un commercial ne voit que SES prospects et SES rdv.
-- Les écritures sensibles (rôles, settings) sont réservées à l'admin.
-- =============================================================

alter table public.profiles enable row level security;
alter table public.prospects enable row level security;
alter table public.rdv enable row level security;
alter table public.prospect_activites enable row level security;
alter table public.app_settings enable row level security;

-- Helpers (security definer pour éviter la récursion RLS sur profiles)
create or replace function public.current_role()
returns user_role language sql stable security definer as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer as $$
  select public.current_role() in ('admin', 'telepro')
$$;

-- ----- profiles -----
-- Tout le monde (authentifié) lit les profils (annuaire interne, hors token —
-- le refresh token n'est jamais sélectionné côté client, et une vue safe existe).
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

-- Chacun met à jour son propre profil ; l'admin met à jour tout le monde.
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.current_role() = 'admin')
  with check (id = auth.uid() or public.current_role() = 'admin');

-- ----- prospects -----
create policy "prospects_select" on public.prospects
  for select to authenticated
  using (public.is_staff() or assigne_a = auth.uid());

create policy "prospects_insert" on public.prospects
  for insert to authenticated
  with check (public.is_staff());

create policy "prospects_update" on public.prospects
  for update to authenticated
  using (public.is_staff() or assigne_a = auth.uid())
  with check (public.is_staff() or assigne_a = auth.uid());

create policy "prospects_delete" on public.prospects
  for delete to authenticated
  using (public.current_role() = 'admin');

-- ----- rdv -----
create policy "rdv_select" on public.rdv
  for select to authenticated
  using (public.is_staff() or commercial_id = auth.uid());

create policy "rdv_insert" on public.rdv
  for insert to authenticated
  with check (public.is_staff());

create policy "rdv_update" on public.rdv
  for update to authenticated
  using (public.is_staff() or commercial_id = auth.uid())
  with check (public.is_staff() or commercial_id = auth.uid());

-- ----- prospect_activites -----
create policy "activites_select" on public.prospect_activites
  for select to authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from public.prospects p
      where p.id = prospect_id and p.assigne_a = auth.uid()
    )
  );

create policy "activites_insert" on public.prospect_activites
  for insert to authenticated
  with check (auteur_id = auth.uid());

-- ----- app_settings -----
create policy "settings_select" on public.app_settings
  for select to authenticated using (true);

create policy "settings_update" on public.app_settings
  for update to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');
