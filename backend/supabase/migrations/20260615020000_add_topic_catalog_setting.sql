insert into public.app_settings (key, value)
values (
  'topic_catalog',
  jsonb_build_array(
    jsonb_build_object('id', 'zuckersteuer', 'label', 'Zuckersteuer / Politik', 'lean', -0.45, 'color', '#e1a53a'),
    jsonb_build_object('id', 'zuckerfrei', 'label', 'Zuckerfrei / Diaet', 'lean', -0.10, 'color', '#0a6cd4'),
    jsonb_build_object('id', 'softdrinks', 'label', 'Softdrinks / Cola', 'lean', -0.20, 'color', '#e0574a'),
    jsonb_build_object('id', 'suesswaren', 'label', 'Suesswaren / Snacks', 'lean', 0.25, 'color', '#16a37b'),
    jsonb_build_object('id', 'backen', 'label', 'Backen / Haushalt', 'lean', 0.40, 'color', '#8a6d3b'),
    jsonb_build_object('id', 'gesundheit', 'label', 'Gesundheit / Diabetes', 'lean', -0.35, 'color', '#6d5ce7'),
    jsonb_build_object('id', 'saisonal', 'label', 'Saisonal / Sommer', 'lean', 0.55, 'color', '#4ea235'),
    jsonb_build_object('id', 'preise', 'label', 'Preise / Inflation', 'lean', -0.25, 'color', '#52617a'),
    jsonb_build_object('id', 'nachhaltig', 'label', 'Nachhaltigkeit', 'lean', 0.30, 'color', '#0a5cb8')
  )
)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();
