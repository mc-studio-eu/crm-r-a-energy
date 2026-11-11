-- Le téléprospecteur voit ses dossiers créés ainsi que ceux qui lui sont affectés.
-- SECURITY DEFINER évite une récursion RLS lors de la lecture de prospects.
create or replace function public.prospect_visible(p_assigne uuid, p_cree uuid, p_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case public.current_role()
    when 'admin' then true
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
