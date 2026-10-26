create table if not exists public.synapse_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Learner' check (char_length(full_name) between 1 and 80),
  username text check (username is null or char_length(username) between 3 and 24),
  birthday date,
  avatar text not null default '👤',
  xp integer not null default 0 check (xp >= 0),
  level integer not null default 1 check (level >= 1),
  created_at timestamptz not null default now()
);

create unique index if not exists synapse_profiles_username_lower_idx
  on public.synapse_profiles (lower(username))
  where username is not null;

create table if not exists public.synapse_decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  source_type text not null check (source_type in ('notes', 'pdf')),
  source_detail text not null default '',
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create index if not exists synapse_decks_user_created_idx
  on public.synapse_decks (user_id, created_at desc);

create table if not exists public.synapse_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  deck_id uuid not null,
  question text not null check (char_length(question) between 1 and 2000),
  answer text not null check (char_length(answer) between 1 and 4000),
  repetition_level integer not null default 0 check (repetition_level >= 0),
  interval_days integer not null default 0 check (interval_days >= 0),
  ease_factor numeric(4, 2) not null default 2.5 check (ease_factor >= 1.3 and ease_factor <= 5),
  next_review_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint synapse_cards_deck_owner_fk
    foreign key (deck_id, user_id)
    references public.synapse_decks (id, user_id)
    on delete cascade,
  unique (id, user_id)
);

create index if not exists synapse_cards_user_due_idx
  on public.synapse_cards (user_id, next_review_at);
create index if not exists synapse_cards_deck_idx
  on public.synapse_cards (deck_id);

create table if not exists public.synapse_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  card_id uuid not null,
  rating text not null check (rating in ('again', 'hard', 'good', 'easy')),
  reviewed_at timestamptz not null default now(),
  constraint synapse_reviews_card_owner_fk
    foreign key (card_id, user_id)
    references public.synapse_cards (id, user_id)
    on delete cascade
);

create index if not exists synapse_reviews_user_reviewed_idx
  on public.synapse_reviews (user_id, reviewed_at desc);

insert into public.synapse_profiles (user_id, full_name)
select
  id,
  coalesce(nullif(raw_user_meta_data ->> 'full_name', ''), nullif(split_part(coalesce(email, ''), '@', 1), ''), 'Learner')
from auth.users
on conflict (user_id) do nothing;

alter table public.synapse_profiles enable row level security;
alter table public.synapse_decks enable row level security;
alter table public.synapse_cards enable row level security;
alter table public.synapse_reviews enable row level security;

revoke all on public.synapse_profiles from anon, authenticated;
grant select on public.synapse_profiles to authenticated;
grant update (full_name, username, birthday, avatar) on public.synapse_profiles to authenticated;
revoke all on public.synapse_decks from anon, authenticated;
grant select, insert, update, delete on public.synapse_decks to authenticated;
revoke all on public.synapse_cards from anon, authenticated;
grant select, insert, delete on public.synapse_cards to authenticated;
revoke all on public.synapse_reviews from anon, authenticated;
grant select on public.synapse_reviews to authenticated;

drop policy if exists "Users can read their Synapse profile" on public.synapse_profiles;
create policy "Users can read their Synapse profile"
  on public.synapse_profiles for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Users can create their Synapse profile" on public.synapse_profiles;
create policy "Users can create their Synapse profile"
  on public.synapse_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "Users can update their Synapse profile" on public.synapse_profiles;
create policy "Users can update their Synapse profile"
  on public.synapse_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can manage their Synapse decks" on public.synapse_decks;
create policy "Users can manage their Synapse decks"
  on public.synapse_decks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can manage their Synapse cards" on public.synapse_cards;
create policy "Users can manage their Synapse cards"
  on public.synapse_cards for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.synapse_decks d
      where d.id = deck_id and d.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can read their Synapse review history" on public.synapse_reviews;
create policy "Users can read their Synapse review history"
  on public.synapse_reviews for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "Users can record their Synapse reviews" on public.synapse_reviews;
create policy "Users can record their Synapse reviews"
  on public.synapse_reviews for insert to authenticated
  with check (user_id = (select auth.uid()));

create or replace function public.create_synapse_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.synapse_profiles (user_id, full_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Learner')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_synapse_profile on auth.users;
create trigger on_auth_user_created_synapse_profile
  after insert on auth.users
  for each row execute procedure public.create_synapse_profile();

create or replace function public.record_synapse_review(
  p_card_id uuid,
  p_rating text,
  p_repetition_level integer,
  p_interval_days integer,
  p_ease_factor numeric,
  p_next_review_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_card public.synapse_cards;
  updated_profile public.synapse_profiles;
  xp_reward integer;
begin
  if p_rating not in ('again', 'hard', 'good', 'easy')
     or p_repetition_level < 0
     or p_interval_days < 0
     or p_interval_days > 36500
     or p_ease_factor < 1.3
     or p_ease_factor > 5
     or p_next_review_at < now()
     or p_next_review_at > now() + interval '100 years' then
    raise exception 'Invalid review schedule.';
  end if;

  update public.synapse_cards
  set repetition_level = p_repetition_level,
      interval_days = p_interval_days,
      ease_factor = p_ease_factor,
      next_review_at = p_next_review_at,
      last_reviewed_at = now()
  where id = p_card_id and user_id = (select auth.uid())
  returning * into updated_card;

  if not found then
    raise exception 'Study card not found.';
  end if;

  insert into public.synapse_reviews (user_id, card_id, rating)
  values ((select auth.uid()), p_card_id, p_rating);

  xp_reward := case p_rating
    when 'again' then 5
    when 'hard' then 8
    when 'good' then 12
    else 16
  end;

  update public.synapse_profiles
  set xp = xp + xp_reward
  where user_id = (select auth.uid())
  returning * into updated_profile;

  while updated_profile.xp >= updated_profile.level * 100 loop
    updated_profile.xp := updated_profile.xp - updated_profile.level * 100;
    updated_profile.level := updated_profile.level + 1;
  end loop;

  update public.synapse_profiles
  set xp = updated_profile.xp,
      level = updated_profile.level
  where user_id = (select auth.uid())
  returning * into updated_profile;

  return jsonb_build_object('card', to_jsonb(updated_card), 'profile', to_jsonb(updated_profile));
end;
$$;

revoke all on function public.record_synapse_review(uuid, text, integer, integer, numeric, timestamptz) from public;
grant execute on function public.record_synapse_review(uuid, text, integer, integer, numeric, timestamptz) to authenticated;

create or replace function public.award_synapse_xp(p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_profile public.synapse_profiles;
begin
  if p_amount not in (20, 50) then
    raise exception 'Invalid XP award.';
  end if;

  update public.synapse_profiles
  set xp = xp + p_amount
  where user_id = (select auth.uid())
  returning * into updated_profile;

  if not found then
    raise exception 'Profile not found.';
  end if;

  while updated_profile.xp >= updated_profile.level * 100 loop
    updated_profile.xp := updated_profile.xp - updated_profile.level * 100;
    updated_profile.level := updated_profile.level + 1;
  end loop;

  update public.synapse_profiles
  set xp = updated_profile.xp,
      level = updated_profile.level
  where user_id = (select auth.uid())
  returning * into updated_profile;
  return to_jsonb(updated_profile);
end;
$$;

revoke all on function public.award_synapse_xp(integer) from public;
grant execute on function public.award_synapse_xp(integer) to authenticated;
