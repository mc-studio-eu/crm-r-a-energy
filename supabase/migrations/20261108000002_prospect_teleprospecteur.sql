-- =============================================================
-- Téléprospecteur à l'origine du prospect (remplace le champ libre
-- « source » dans l'interface ; la colonne source est conservée pour
-- l'historique).
-- =============================================================

alter table public.prospects
  add column if not exists teleprospecteur_id uuid references public.profiles (id) on delete set null;

create index if not exists prospects_teleprospecteur_id_idx on public.prospects (teleprospecteur_id);
