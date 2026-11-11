-- =============================================================
-- Fournisseur d'énergie associé au prospect.
-- =============================================================

alter table public.prospects
  add column if not exists fournisseur text
  check (fournisseur in ('gazelle_energy', 'mint', 'ohm', 'jeety'));
