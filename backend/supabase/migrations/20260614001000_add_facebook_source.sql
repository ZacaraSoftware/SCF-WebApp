-- Add missing source id for Facebook ingestion to satisfy mentions.source FK.
insert into public.sources (id, label, status)
values ('facebook', 'Facebook Graph API', 'active')
on conflict (id) do nothing;
