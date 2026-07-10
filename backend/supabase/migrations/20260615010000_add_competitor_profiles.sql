create table if not exists public.competitor_profiles (
  name text primary key,
  aliases text[] not null default '{}',
  query_hints text[] not null default '{}',
  require_context boolean not null default false,
  color text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.competitor_profiles (name, aliases, query_hints, require_context, color, active)
values
  (
    'Nordzucker',
    array['nordzucker'],
    array['nordzucker'],
    false,
    '#004b93',
    true
  ),
  (
    'Südzucker',
    array['südzucker','suedzucker'],
    array['suedzucker'],
    false,
    '#8a6d3b',
    true
  ),
  (
    'Pfeifer & Langen',
    array['pfeifer langen','pfeifer und langen'],
    array['"pfeifer langen"'],
    true,
    '#6d5ce7',
    true
  ),
  (
    'Cosun Beet',
    array['cosun beet','cosun'],
    array['"cosun beet"'],
    true,
    '#16a37b',
    true
  )
on conflict (name) do update
set
  aliases = excluded.aliases,
  query_hints = excluded.query_hints,
  require_context = excluded.require_context,
  color = excluded.color,
  active = excluded.active,
  updated_at = now();

alter table public.competitor_profiles enable row level security;

drop policy if exists "read_competitor_profiles_authenticated" on public.competitor_profiles;
create policy "read_competitor_profiles_authenticated"
  on public.competitor_profiles for select to authenticated using (true);

drop policy if exists "read_competitor_profiles_anon" on public.competitor_profiles;
create policy "read_competitor_profiles_anon"
  on public.competitor_profiles for select to anon using (true);
