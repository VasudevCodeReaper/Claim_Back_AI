-- ClaimBack AI: persistent claim packets
-- Run this once in Supabase Dashboard -> SQL Editor -> New query.
-- This stores claim metadata only. Receipt files are intentionally not stored yet.

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  claim_id text not null unique,
  status text not null default 'Claim packet ready',
  merchant text,
  order_id text,
  issue text,
  problem_details text,
  amount numeric,
  currency text not null default 'INR',
  transaction_date date,
  policy_url text,
  receipt_name text,
  receipt_check text,
  policy_check jsonb,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.claims enable row level security;

drop policy if exists "Users can view their own claims" on public.claims;
create policy "Users can view their own claims"
  on public.claims for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own claims" on public.claims;
create policy "Users can create their own claims"
  on public.claims for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own claims" on public.claims;
create policy "Users can update their own claims"
  on public.claims for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own claims" on public.claims;
create policy "Users can delete their own claims"
  on public.claims for delete
  using (auth.uid() = user_id);
