alter table public.prospects
  add column scoring_entreprise numeric
    constraint prospects_scoring_entreprise_range check (scoring_entreprise between 0 and 10);

comment on column public.prospects.scoring_entreprise is
  'Note facultative de scoring entreprise sur 10.';
