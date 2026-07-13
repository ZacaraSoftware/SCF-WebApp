-- Add flavor extraction fields for product-development trend analysis.
alter table public.mentions
  add column if not exists primary_flavor text,
  add column if not exists flavor_tags text[] not null default '{}',
  add column if not exists flavor_confidence numeric(4,3);

create index if not exists mentions_primary_flavor_idx on public.mentions (primary_flavor);
create index if not exists mentions_flavor_tags_gin_idx on public.mentions using gin (flavor_tags);
