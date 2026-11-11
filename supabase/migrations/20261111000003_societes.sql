create table public.societes (
  id uuid primary key default gen_random_uuid(),
  raison_sociale text not null,
  siret text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.prospects
  add column societe_id uuid references public.societes(id),
  add column energie text check (energie in ('gaz', 'electricite')),
  add column date_signature date,
  add column debut_livraison date,
  add column fin_livraison date,
  add constraint prospects_livraison_dates check (fin_livraison >= debut_livraison);

-- Chaque fiche existante garde son identité et son historique, y compris si le SIRET est partagé.
insert into public.societes (id, raison_sociale, siret, created_at, updated_at)
select id, raison_sociale, siret, created_at, updated_at
from public.prospects;

alter table public.prospects disable trigger prospects_updated_at;

update public.prospects p
set societe_id = s.id,
    statut = case when p.statut in ('nouveau', 'a_rappeler') then 'en_cours'::public.prospect_statut else p.statut end
from public.societes s
where p.id = s.id;

alter table public.prospects enable trigger prospects_updated_at;
alter table public.prospects
  alter column societe_id set not null,
  alter column statut set default 'en_cours',
  add constraint prospects_statut_actif check (statut in ('en_cours', 'rdv_place', 'signe', 'perdu'));

create index prospects_societe_id_idx on public.prospects(societe_id);
create index societes_raison_sociale_id_idx on public.societes(raison_sociale, id);

alter table public.societes enable row level security;
revoke all on public.societes from public, anon, authenticated;
grant select on public.societes to authenticated, service_role;

create policy societes_select on public.societes
  for select to authenticated
  using (
    public.account_active()
    and (
      public.current_role() = 'admin'
      or exists (select 1 from public.prospects p where p.societe_id = societes.id)
    )
  );

create trigger societes_updated_at before update on public.societes
  for each row execute function public.set_updated_at();

-- Les colonnes d'identité historiques restent lisibles dans les listes et les RDV.
-- Créer un dossier et sa nouvelle société se fait dans la même transaction.
create function public.set_dossier_societe()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  societe public.societes%rowtype;
begin
  if new.societe_id is null and tg_op = 'INSERT' then
    if nullif(btrim(new.raison_sociale), '') is null then
      raise exception using errcode = '22023', message = 'Saisissez une raison sociale.';
    end if;

    insert into public.societes (raison_sociale, siret)
    values (btrim(new.raison_sociale), nullif(btrim(new.siret), ''))
    returning * into societe;
  else
    if tg_op = 'UPDATE' and new.societe_id is distinct from old.societe_id
        and auth.role() is distinct from 'service_role'
        and public.current_role() is distinct from 'admin' then
      raise exception using errcode = '42501', message = 'Rattachement réservé aux administrateurs.';
    end if;

    if tg_op = 'INSERT'
        and auth.role() is distinct from 'service_role'
        and public.current_role() is distinct from 'admin'
        and not exists (
          select 1 from public.prospects p
          where p.societe_id = new.societe_id and public.prospect_visible(p.assigne_a, p.cree_par, p.id)
        ) then
      raise exception using errcode = '42501', message = 'Société inaccessible.';
    end if;

    select * into societe from public.societes where id = new.societe_id for share;
    if not found then
      raise exception using errcode = '23503', message = 'Société introuvable.';
    end if;

    if tg_op = 'UPDATE' and new.societe_id = old.societe_id and (
      new.raison_sociale is distinct from societe.raison_sociale or new.siret is distinct from societe.siret
    ) then
      raise exception using errcode = '22023', message = 'Modifiez l’identité dans la fiche société.';
    end if;
  end if;

  new.societe_id := societe.id;
  new.raison_sociale := societe.raison_sociale;
  new.siret := societe.siret;
  return new;
end;
$$;

revoke execute on function public.set_dossier_societe() from public, anon, authenticated;
create trigger prospects_set_dossier_societe
  before insert or update of societe_id, raison_sociale, siret on public.prospects
  for each row execute function public.set_dossier_societe();

create function public.update_societe(p_id uuid, p_raison_sociale text, p_siret text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if public.current_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Modification réservée aux administrateurs.';
  end if;
  if nullif(btrim(p_raison_sociale), '') is null then
    raise exception using errcode = '22023', message = 'Saisissez une raison sociale.';
  end if;

  update public.societes
  set raison_sociale = btrim(p_raison_sociale), siret = nullif(btrim(p_siret), '')
  where id = p_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Société introuvable.';
  end if;

  update public.prospects
  set raison_sociale = btrim(p_raison_sociale), siret = nullif(btrim(p_siret), '')
  where societe_id = p_id;
end;
$$;

create function public.merge_societes(p_source uuid, p_cible uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  nom_source text;
  nom_cible text;
begin
  if public.current_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Fusion réservée aux administrateurs.';
  end if;
  if p_source is null or p_cible is null or p_source = p_cible then
    raise exception using errcode = '22023', message = 'Sélectionnez deux sociétés distinctes.';
  end if;

  perform 1 from public.societes where id in (p_source, p_cible) order by id for update;
  select raison_sociale into nom_source from public.societes where id = p_source;
  select raison_sociale into nom_cible from public.societes where id = p_cible;
  if nom_source is null or nom_cible is null then
    raise exception using errcode = 'P0002', message = 'Société introuvable.';
  end if;

  with dossiers_deplaces as (
    update public.prospects set societe_id = p_cible where societe_id = p_source returning id
  )
  insert into public.prospect_activites (prospect_id, auteur_id, type, detail)
  select id, auth.uid(), 'modification', format('Société fusionnée : %s → %s', nom_source, nom_cible)
  from dossiers_deplaces;

  delete from public.societes where id = p_source;
end;
$$;

revoke execute on function public.update_societe(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.merge_societes(uuid, uuid) from public, anon, authenticated;
grant execute on function public.update_societe(uuid, text, text) to authenticated;
grant execute on function public.merge_societes(uuid, uuid) to authenticated;
