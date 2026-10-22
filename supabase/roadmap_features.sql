-- ClaimBack AI: policy snapshots, audit log, guided-submission state, and recovery tracking.
-- Run once in Supabase Dashboard -> SQL Editor after the earlier two ClaimBack SQL files.

alter table public.claims
  add column if not exists policy_checked_at timestamptz,
  add column if not exists submitted_at timestamptz,
  add column if not exists recovered_at timestamptz,
  add column if not exists recovered_amount numeric;

create table if not exists public.claim_events (
  id uuid primary key default gen_random_uuid(),
  claim_uuid uuid not null references public.claims(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  event_label text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.claim_advocacy_cases (
  claim_uuid uuid primary key references public.claims(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  support_url text not null,
  objective text,
  case_memory jsonb not null default '{}'::jsonb,
  status text not null default 'ready',
  last_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.claim_events drop constraint if exists claim_events_event_type_check;
alter table public.claim_events add constraint claim_events_event_type_check
  check (event_type in ('receipt_analysis_consented', 'receipt_extracted', 'fields_reviewed', 'claim_created', 'receipt_stored', 'policy_checked', 'submission_confirmed', 'refund_received', 'chat_run_started', 'chat_run_completed', 'chat_run_cancelled', 'chat_run_failed', 'chat_conclusion', 'sandbox_run_started', 'sandbox_draft_ready', 'sandbox_run_cancelled', 'sandbox_run_failed', 'sandbox_submitted'));

create index if not exists claim_events_claim_uuid_created_at_idx
  on public.claim_events (claim_uuid, created_at asc);

alter table public.claim_events enable row level security;

drop policy if exists "Users can read their own claim audit events" on public.claim_events;
create policy "Users can read their own claim audit events"
  on public.claim_events for select
  using (auth.uid() = user_id);

drop policy if exists "Users can write their own claim audit events" on public.claim_events;
create policy "Users can write their own claim audit events"
  on public.claim_events for insert
  with check (auth.uid() = user_id);

alter table public.claim_advocacy_cases enable row level security;

drop policy if exists "Users can read their own advocacy cases" on public.claim_advocacy_cases;
create policy "Users can read their own advocacy cases"
  on public.claim_advocacy_cases for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own advocacy cases" on public.claim_advocacy_cases;
create policy "Users can create their own advocacy cases"
  on public.claim_advocacy_cases for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own advocacy cases" on public.claim_advocacy_cases;
create policy "Users can update their own advocacy cases"
  on public.claim_advocacy_cases for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.claimback_set_updated_at()
returns trigger language plpgsql security invoker as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists claimback_claims_updated_at on public.claims;
create trigger claimback_claims_updated_at
  before update on public.claims
  for each row execute function public.claimback_set_updated_at();
