-- La lecture des dossiers et de leurs sociétés reste indépendante des droits financiers.
create or replace function public.prospect_visible(p_assigne uuid, p_cree uuid, p_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case public.current_role()
    when 'admin' then true
    when 'administratif' then true
    when 'telepro' then
      p_cree = auth.uid()
      or exists (
        select 1 from public.prospects p
        where p.id = p_id and p.teleprospecteur_id = auth.uid()
      )
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

-- RLS contrôle les lignes ; cette garde limite les colonnes modifiables à la fiche métier.
-- Le trigger s’exécute avant l’actualisation automatique d’updated_at.
create function public.prospect_verifier_modification_administrative()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare
  champs_modifiables constant text[] := array[
    'raison_sociale', 'siret', 'contact_nom', 'telephone', 'email', 'adresse',
    'code_postal', 'ville', 'lat', 'lng', 'statut', 'source', 'notes', 'assigne_a',
    'energie', 'date_signature', 'debut_livraison', 'fin_livraison',
    'fournisseur', 'teleprospecteur_id', 'scoring_entreprise'
  ];
begin
  if (to_jsonb(new) - champs_modifiables) is distinct from (to_jsonb(old) - champs_modifiables) then
    raise exception using errcode = '42501', message = 'Modification réservée aux informations du dossier.';
  end if;
  return new;
end;
$$;

revoke all on function public.prospect_verifier_modification_administrative() from public, anon, authenticated, service_role;
create trigger prospects_administratif_update
  before update on public.prospects
  for each row when (public.current_role() = 'administratif')
  execute function public.prospect_verifier_modification_administrative();

-- Un changement de rôle ne donne plus accès aux rendez-vous anciennement assignés.
create policy rdv_exclure_administratif on public.rdv
  as restrictive for all to authenticated
  using (public.current_role() is distinct from 'administratif')
  with check (public.current_role() is distinct from 'administratif');

alter policy documents_select on public.prospect_documents using (
  public.current_role() = 'admin'
  or (
    public.current_role() in ('administratif', 'regie_externe')
    and exists (select 1 from public.prospects p where p.id = prospect_id)
  )
);

alter policy documents_insert on public.prospect_documents with check (
  uploade_par = auth.uid()
  and (
    public.current_role() = 'admin'
    or (
      public.current_role() in ('administratif', 'regie_externe')
      and exists (select 1 from public.prospects p where p.id = prospect_id)
    )
  )
);

alter policy documents_delete on public.prospect_documents using (
  public.current_role() = 'admin'
  or (public.current_role() in ('administratif', 'regie_externe') and uploade_par = auth.uid())
);

alter policy prospect_docs_read on storage.objects using (
  bucket_id = 'prospect-documents'
  and (
    public.current_role() = 'admin'
    or (
      public.current_role() in ('administratif', 'regie_externe')
      and exists (
        select 1 from public.prospects p
        where p.id::text = (storage.foldername(name))[1]
      )
    )
  )
);

alter policy prospect_docs_upload on storage.objects with check (
  bucket_id = 'prospect-documents'
  and (
    public.current_role() = 'admin'
    or (
      public.current_role() in ('administratif', 'regie_externe')
      and exists (
        select 1 from public.prospects p
        where p.id::text = (storage.foldername(name))[1]
      )
    )
  )
);

alter policy prospect_docs_delete on storage.objects using (
  bucket_id = 'prospect-documents'
  and (
    public.current_role() = 'admin'
    or (public.current_role() in ('administratif', 'regie_externe') and owner_id = auth.uid()::text)
  )
);
