alter table public.synapse_profiles
  add column if not exists starter_decks_seeded boolean not null default false;

grant update (starter_decks_seeded) on public.synapse_profiles to authenticated;
