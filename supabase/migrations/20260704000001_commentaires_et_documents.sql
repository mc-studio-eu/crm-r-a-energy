-- =============================================================
-- Commentaires sur la fiche & documents du prospect
-- Phase 1 : commentaires — réutilise prospect_activites (type
--   'commentaire'), les policies select/insert existent déjà.
-- Phase 2 : table prospect_documents + bucket Storage privé.
-- =============================================================

-- ---------- prospect_documents ----------
create table public.prospect_documents (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  -- Nom libre saisi par l'utilisateur ("Contrat", "RIB"…)
  nom text not null,
  storage_path text not null unique,
  mime_type text,
  taille bigint,
  uploade_par uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index prospect_documents_prospect_idx
  on public.prospect_documents (prospect_id, created_at desc);

alter table public.prospect_documents enable row level security;

-- Lecture : tout le monde (aligné sur prospects visibles par tous).
create policy "documents_select" on public.prospect_documents
  for select to authenticated using (true);

-- Ajout : staff, ou commercial sur ses prospects assignés.
create policy "documents_insert" on public.prospect_documents
  for insert to authenticated
  with check (
    uploade_par = auth.uid()
    and (
      public.is_staff()
      or exists (
        select 1 from public.prospects p
        where p.id = prospect_id and p.assigne_a = auth.uid()
      )
    )
  );

-- Suppression : l'auteur de l'upload ou un admin.
create policy "documents_delete" on public.prospect_documents
  for delete to authenticated
  using (uploade_par = auth.uid() or public.current_role() = 'admin');

-- ---------- Bucket Storage privé ----------
-- Chemin des objets : {prospect_id}/{uuid}.{extension}
insert into storage.buckets (id, name, public)
values ('prospect-documents', 'prospect-documents', false)
on conflict (id) do nothing;

create policy "prospect_docs_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'prospect-documents');

create policy "prospect_docs_upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'prospect-documents'
    and (
      public.is_staff()
      or exists (
        select 1 from public.prospects p
        where p.id::text = (storage.foldername(name))[1]
          and p.assigne_a = auth.uid()
      )
    )
  );

create policy "prospect_docs_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'prospect-documents'
    and (owner_id = auth.uid()::text or public.current_role() = 'admin')
  );
