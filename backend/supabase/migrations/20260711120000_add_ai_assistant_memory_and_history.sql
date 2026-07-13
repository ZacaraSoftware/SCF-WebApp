-- ============================================================================
-- KI-Assistent: Persistenter Verlauf + Gespraechsgedaechtnis
-- ----------------------------------------------------------------------------
-- Ziel:
-- 1) Chat-Historie pro Browser-Session dauerhaft speichern
-- 2) Kompaktes Arbeitsgedaechtnis je Unterhaltung halten
-- 3) Edge Function arbeitet mit service_role, Frontend liest/schreibt nicht direkt
-- ============================================================================

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  title text,
  last_question text,
  memory_summary text,
  memory_facts jsonb not null default '[]'::jsonb,
  memory_decisions jsonb not null default '[]'::jsonb,
  message_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_conversations_session_updated_idx
  on public.ai_conversations (session_id, updated_at desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  retrieval_hits int,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);

create index if not exists ai_messages_conversation_created_idx
  on public.ai_messages (conversation_id, created_at asc);

create or replace function public.touch_ai_conversation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ai_conversations_touch_updated_at on public.ai_conversations;
create trigger trg_ai_conversations_touch_updated_at
before update on public.ai_conversations
for each row execute function public.touch_ai_conversation_updated_at();

-- RLS bleibt aktiv, aber Tabellen sind nicht direkt fuer anon/authenticated vorgesehen.
-- Nur service_role (Edge Functions) schreibt/liest.
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

-- Optional: explizite deny-default Policies fuer Klarheit.
drop policy if exists "deny_ai_conversations_anon" on public.ai_conversations;
create policy "deny_ai_conversations_anon"
  on public.ai_conversations for all to anon using (false) with check (false);

drop policy if exists "deny_ai_messages_anon" on public.ai_messages;
create policy "deny_ai_messages_anon"
  on public.ai_messages for all to anon using (false) with check (false);
