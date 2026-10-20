-- LINGUA/OS · Supabase migration for user_id-based cloud sync (v2.6)
-- Run manually in Supabase SQL Editor after taking a backup.
-- The application keeps working locally before this migration; it reports
-- "Cloud not ready" instead of writing an unverified e-mail row.

-- 1. Ownership column. Existing rows stay untouched and keep user_id = null.
alter table public.user_data
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- 2. Upsert target for onConflict: "user_id". A normal unique index is required
--    here: PostgreSQL ON CONFLICT can infer it, and multiple NULL user_id values
--    are allowed.
create unique index if not exists user_data_user_id_key
  on public.user_data (user_id);

-- 3. Row-level security. Old rows with null user_id are not visible to users.
-- Review this block before running it. It removes every existing policy on
-- public.user_data (including legacy permissive ones), then creates only the
-- owner-scoped policies below. Policies are not data and can be restored.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'user_data'
  loop
    execute format('drop policy %I on public.user_data', policy_row.policyname);
  end loop;
end $$;

alter table public.user_data enable row level security;

drop policy if exists "user_data_select_own" on public.user_data;
drop policy if exists "user_data_insert_own" on public.user_data;
drop policy if exists "user_data_update_own" on public.user_data;
drop policy if exists "user_data_delete_own" on public.user_data;

create policy "user_data_select_own"
  on public.user_data for select
  using (auth.uid() = user_id);

create policy "user_data_insert_own"
  on public.user_data for insert
  with check (auth.uid() = user_id);

create policy "user_data_update_own"
  on public.user_data for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_data_delete_own"
  on public.user_data for delete
  using (auth.uid() = user_id);

-- 4. Safe legacy backfill. This is intentionally limited to accounts whose
-- Supabase e-mail is verified. Run it only after checking the SELECT result.
-- It never deletes data and never matches unverified accounts.
--
-- select d.user_email, u.id, u.email, u.email_confirmed_at
-- from public.user_data d
-- join auth.users u on lower(d.user_email) = lower(u.email)
-- where d.user_id is null and u.email_confirmed_at is not null;
--
update public.user_data d
set user_id = u.id
from auth.users u
where d.user_id is null
  and lower(d.user_email) = lower(u.email)
  and u.email_confirmed_at is not null;

-- 5. Ask PostgREST to reload the schema cache after adding the column.
notify pgrst, 'reload schema';

-- Notes:
-- * The app still sends user_email as descriptive data, but never looks up or
--   trusts it for ownership.
-- * If user_email is still a PRIMARY KEY and blocks new rows, backfill first;
--   if necessary, after a backup:
--   alter table public.user_data drop constraint if exists user_data_pkey;
--   alter table public.user_data add primary key (user_id);
-- * Do not run the backfill for unverified e-mail accounts.
