-- Tout le monde (admin / telepro / commercial) voit tous les prospects.
drop policy "prospects_select" on public.prospects;
create policy "prospects_select" on public.prospects
  for select to authenticated using (true);

-- Les activités suivent : visibles sur toutes les fiches prospects.
drop policy "activites_select" on public.prospect_activites;
create policy "activites_select" on public.prospect_activites
  for select to authenticated using (true);
