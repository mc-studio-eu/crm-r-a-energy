create table public.fournisseurs (
  code text primary key default gen_random_uuid()::text,
  nom text not null check (
    char_length(nom) between 1 and 120 and nom = btrim(nom) and nom ~ '[^[:space:]_]'
  ),
  actif boolean not null default true
);

create unique index fournisseurs_nom_unique on public.fournisseurs (
  (btrim(regexp_replace(regexp_replace(lower(normalize(nom, NFD)), U&'[\0300-\036F]', '', 'g'), '[[:space:]_]+', ' ', 'g')))
);

insert into public.fournisseurs (code, nom) values
  ('gazelle_energy', 'Gazelle Energy'), ('mint', 'Mint'), ('ohm', 'Ohm'), ('jeety', 'Jeety');

alter table public.fournisseurs enable row level security;
revoke all on public.fournisseurs from public, anon, authenticated, service_role;
grant select on public.fournisseurs to authenticated, service_role;
grant insert (nom, actif), update (nom, actif) on public.fournisseurs to authenticated;

create policy fournisseurs_select on public.fournisseurs for select to authenticated
  using (public.account_active());
create policy fournisseurs_insert on public.fournisseurs for insert to authenticated
  with check (public.current_role() = 'admin');
create policy fournisseurs_update on public.fournisseurs for update to authenticated
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

alter table public.prospects
  drop constraint prospects_fournisseur_check,
  add constraint prospects_fournisseur_fkey foreign key (fournisseur) references public.fournisseurs(code);

create function public.verifier_fournisseur_dossier()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if tg_op = 'UPDATE' and new.fournisseur is not distinct from old.fournisseur then
    return new;
  end if;

  if new.fournisseur is not null then
    -- Sérialise une nouvelle affectation avec la désactivation du fournisseur.
    perform 1 from public.fournisseurs where code = new.fournisseur and actif for share;
    if not found then
      raise exception using errcode = '23514', constraint = 'prospects_fournisseur_actif',
        message = 'Le fournisseur sélectionné est indisponible.';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.verifier_fournisseur_dossier() from public, anon, authenticated, service_role;
create trigger prospects_verifier_fournisseur before insert or update of fournisseur on public.prospects
  for each row execute function public.verifier_fournisseur_dossier();
