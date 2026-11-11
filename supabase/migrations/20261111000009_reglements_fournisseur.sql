-- Échéancier contractuel du fournisseur, indépendant du registre financier.
create table public.prospect_reglements_fournisseur (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete restrict,
  libelle text not null check (
    char_length(libelle) between 1 and 150 and libelle = btrim(libelle) and libelle ~ '[^[:space:]]'
  ),
  date_prevue date check (date_prevue between date '0001-01-01' and date '9999-12-31'),
  annee_prevue integer check (annee_prevue between 1 and 9999),
  montant_cents bigint check (montant_cents between 1 and 1000000000000),
  taux_bps integer check (taux_bps between 1 and 10000),
  date_reception date check (date_reception between date '0001-01-01' and date '9999-12-31'),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  check (date_prevue is null or annee_prevue is null)
);

create index prospect_reglements_fournisseur_prospect_idx
  on public.prospect_reglements_fournisseur (prospect_id, created_at, id);

alter table public.prospect_reglements_fournisseur enable row level security;
revoke all on public.prospect_reglements_fournisseur from public, anon, authenticated, service_role;
grant select, delete on public.prospect_reglements_fournisseur to authenticated;
grant insert (prospect_id, libelle, date_prevue, annee_prevue, montant_cents, taux_bps, date_reception, note),
      update (libelle, date_prevue, annee_prevue, montant_cents, taux_bps, date_reception, note)
  on public.prospect_reglements_fournisseur to authenticated;

create policy prospect_reglements_fournisseur_admin
  on public.prospect_reglements_fournisseur for all to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');
