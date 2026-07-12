-- =============================================================
-- Visibilité des fiches par rôle + accès documents (règles client 10/07) :
--  - admin          : voit tout
--  - telepro        : voit les fiches qu'il a créées
--  - commercial     : voit les fiches assignées OU avec un RDV pour lui
--  - regie_interne  : voit ses fiches (assignées ou créées) ; place ses RDV
--  - regie_externe  : voit ses fiches ; seule non-admin à accéder aux documents
-- Documents : admin (tout) + régie externe (voir sur ses fiches,
-- ajouter, supprimer les siens).
-- =============================================================

-- ---------- Helpers ----------
create or replace function public.is_regie()
returns boolean language sql stable security definer as $$
  select public.current_role() in ('regie_interne', 'regie_externe')
$$;

-- Visibilité d'une fiche prospect selon le rôle courant.
-- Security definer : la sous-requête rdv ignore la RLS (elle filtre
-- déjà explicitement sur commercial_id = auth.uid()).
create or replace function public.prospect_visible(p_assigne uuid, p_cree uuid, p_id uuid)
returns boolean language sql stable security definer as $$
  select case public.current_role()
    when 'admin' then true
    when 'telepro' then p_cree = auth.uid()
    when 'commercial' then
      p_assigne = auth.uid()
      or exists (
        select 1 from public.rdv r
        where r.prospect_id = p_id and r.commercial_id = auth.uid()
      )
    when 'regie_interne' then p_assigne = auth.uid() or p_cree = auth.uid()
    when 'regie_externe' then p_assigne = auth.uid() or p_cree = auth.uid()
    else false
  end
$$;

-- ---------- prospects ----------
drop policy "prospects_select" on public.prospects;
create policy "prospects_select" on public.prospects
  for select to authenticated
  using (public.prospect_visible(assigne_a, cree_par, id));

-- Création : staff, ou une régie pour ses propres fiches (cree_par forcé à soi).
drop policy "prospects_insert" on public.prospects;
create policy "prospects_insert" on public.prospects
  for insert to authenticated
  with check (
    public.current_role() in ('admin', 'telepro')
    or (public.is_regie() and cree_par = auth.uid())
  );

-- Modification : chacun modifie ce qu'il voit.
drop policy "prospects_update" on public.prospects;
create policy "prospects_update" on public.prospects
  for update to authenticated
  using (public.prospect_visible(assigne_a, cree_par, id))
  with check (public.prospect_visible(assigne_a, cree_par, id));

-- ---------- prospect_activites ----------
-- Hérite de la visibilité prospects (la RLS s'applique dans la sous-requête).
drop policy "activites_select" on public.prospect_activites;
create policy "activites_select" on public.prospect_activites
  for select to authenticated
  using (
    exists (select 1 from public.prospects p where p.id = prospect_id)
  );

-- ---------- prospect_documents (table) ----------
-- Admin : tout. Régie externe : documents de ses fiches uniquement.
drop policy "documents_select" on public.prospect_documents;
create policy "documents_select" on public.prospect_documents
  for select to authenticated
  using (
    public.current_role() = 'admin'
    or (
      public.current_role() = 'regie_externe'
      and exists (select 1 from public.prospects p where p.id = prospect_id)
    )
  );

drop policy "documents_insert" on public.prospect_documents;
create policy "documents_insert" on public.prospect_documents
  for insert to authenticated
  with check (
    uploade_par = auth.uid()
    and (
      public.current_role() = 'admin'
      or (
        public.current_role() = 'regie_externe'
        and exists (select 1 from public.prospects p where p.id = prospect_id)
      )
    )
  );

drop policy "documents_delete" on public.prospect_documents;
create policy "documents_delete" on public.prospect_documents
  for delete to authenticated
  using (
    public.current_role() = 'admin'
    or (public.current_role() = 'regie_externe' and uploade_par = auth.uid())
  );

-- ---------- prospect-documents (storage) ----------
drop policy "prospect_docs_read" on storage.objects;
create policy "prospect_docs_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'prospect-documents'
    and (
      public.current_role() = 'admin'
      or (
        public.current_role() = 'regie_externe'
        and exists (
          select 1 from public.prospects p
          where p.id::text = (storage.foldername(name))[1]
        )
      )
    )
  );

drop policy "prospect_docs_upload" on storage.objects;
create policy "prospect_docs_upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'prospect-documents'
    and (
      public.current_role() = 'admin'
      or (
        public.current_role() = 'regie_externe'
        and exists (
          select 1 from public.prospects p
          where p.id::text = (storage.foldername(name))[1]
        )
      )
    )
  );

drop policy "prospect_docs_delete" on storage.objects;
create policy "prospect_docs_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'prospect-documents'
    and (
      public.current_role() = 'admin'
      or (public.current_role() = 'regie_externe' and owner_id = auth.uid()::text)
    )
  );
