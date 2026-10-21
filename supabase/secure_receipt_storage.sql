-- ClaimBack AI: private receipt storage and deletion controls
-- Run once in Supabase Dashboard -> SQL Editor after claims_schema.sql.

alter table public.claims
  add column if not exists receipt_path text,
  add column if not exists receipt_content_type text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'claimback-receipts',
  'claimback-receipts',
  false,
  2800000,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = 2800000,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

-- Every object path begins with the authenticated user's UUID.
-- These policies prevent users from reading, writing, or deleting another user's receipts.
drop policy if exists "ClaimBack users read their own receipts" on storage.objects;
create policy "ClaimBack users read their own receipts"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'claimback-receipts'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "ClaimBack users upload their own receipts" on storage.objects;
create policy "ClaimBack users upload their own receipts"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'claimback-receipts'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "ClaimBack users delete their own receipts" on storage.objects;
create policy "ClaimBack users delete their own receipts"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'claimback-receipts'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
