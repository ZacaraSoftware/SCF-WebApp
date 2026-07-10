create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value)
values
  (
    'signal_config',
    jsonb_build_object(
      'maxSignals', 3,
      'coverageMinMentions', 50,
      'rules', jsonb_build_object(
        'softdrinks', jsonb_build_object('minVol', 2, 'maxSent', -0.15),
        'seasonal', jsonb_build_object('minVol', 2, 'minDeltaPct', 20, 'minSent', 0.0),
        'tax', jsonb_build_object('minVol', 2, 'minDeltaPct', 20)
      )
    )
  ),
  (
    'trend_focus_topics',
    jsonb_build_array('saisonal', 'softdrinks', 'zuckersteuer', 'gesundheit')
  )
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

alter table public.app_settings enable row level security;

drop policy if exists "read_app_settings_authenticated" on public.app_settings;
create policy "read_app_settings_authenticated"
  on public.app_settings for select to authenticated using (true);

drop policy if exists "read_app_settings_anon" on public.app_settings;
create policy "read_app_settings_anon"
  on public.app_settings for select to anon using (true);
