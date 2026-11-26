-- The Office, phase 8: team roles (assistant, CPA), the Agents Desk, settings, and phone notifications.
-- Run after the earlier office-*.sql files. Safe to run more than once. Tables from phases you have not
-- run yet are skipped; run this file again after running them.
--
-- Roles
--   owner      Factory admins (public.factory_is_admin()). Everything, as before.
--   assistant  Plan, Run and Grow: goals, tasks, reminders, notes, feed, schedule, CRM, incubator, studio,
--              library. No money, no Factory, no bank or channel connections, no team or settings.
--   cpa        Money, read-only: invoices, payments, bills, expenses, the books and reports. Nothing else.
-- A person gets a role when the owner adds their email on the Team page and they sign in with that email.

-- Team members ---------------------------------------------------------------------------------------
create table if not exists public.office_members (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name text,
  role text not null check (role in ('assistant','cpa')),
  active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

/** The signed-in person's Office role: owner, assistant, cpa, or null. */
create or replace function public.office_role() returns text
language plpgsql stable security definer set search_path = public as $$
declare r text;
begin
  if public.factory_is_admin() then return 'owner'; end if;
  select m.role into r from public.office_members m
   where m.active and m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
   limit 1;
  return r;
end $$;
revoke all on function public.office_role() from public, anon;
grant execute on function public.office_role() to authenticated;

create or replace function public.office_can_work() returns boolean
language sql stable security definer set search_path = public as $$ select public.office_role() in ('owner','assistant') $$;
create or replace function public.office_can_see_money() returns boolean
language sql stable security definer set search_path = public as $$ select public.office_role() in ('owner','cpa') $$;
revoke all on function public.office_can_work() from public, anon;
revoke all on function public.office_can_see_money() from public, anon;
grant execute on function public.office_can_work() to authenticated;
grant execute on function public.office_can_see_money() to authenticated;

/** Called by the Office when a member opens it, so the Team page shows who has signed in. */
create or replace function public.office_touch_member() returns text
language plpgsql security definer set search_path = public as $$
declare r text := public.office_role();
begin
  if r in ('assistant','cpa') then
    update public.office_members set last_seen_at = now() where email = lower(coalesce(auth.jwt() ->> 'email', ''));
  end if;
  return r;
end $$;
revoke all on function public.office_touch_member() from public, anon;
grant execute on function public.office_touch_member() to authenticated;

alter table public.office_members enable row level security;
drop policy if exists office_members_admin on public.office_members;
create policy office_members_admin on public.office_members for all to authenticated
  using ((select public.factory_is_admin())) with check ((select public.factory_is_admin()));
revoke all on public.office_members from anon;
grant select, insert, update, delete on public.office_members to authenticated;

-- Row-level security by role -----------------------------------------------------------------------------
do $$
declare
  t text;
  -- Plan, Run and Grow: the owner and an assistant can read and change these.
  work text[] := array[
    'office_goals','office_tasks','office_reminders','office_notes','office_daily_plans',
    'office_feed_sources','office_feed_items','office_time_blocks','office_weekly_reviews',
    'office_companies','office_contacts','office_contact_businesses','office_pipelines','office_deals','office_activities',
    'office_ventures','office_venture_docs','office_readiness_items','office_venture_reviews','office_venture_chats',
    'office_brand_kits','office_assets','office_content','office_publications'];
  -- Money: the owner keeps full access (its existing policy); a CPA may read.
  money text[] := array[
    'bill_customers','bill_products','bill_invoices','bill_invoice_lines','bill_payments','bill_subscriptions',
    'acct_accounts','acct_journal_entries','acct_journal_lines','acct_periods','acct_bills','acct_expenses',
    'acct_bank_accounts','acct_bank_txns','acct_rules'];
  -- Everyone with a role reads these; only the owner changes them.
  shared text[] := array['office_businesses','acct_entities'];
begin
  foreach t in array work loop
    continue when to_regclass('public.' || t) is null;
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('drop policy if exists %I on public.%I', t || '_work', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.office_can_work())) with check ((select public.office_can_work()))', t || '_work', t);
  end loop;
  foreach t in array money loop
    continue when to_regclass('public.' || t) is null;
    execute format('drop policy if exists %I on public.%I', t || '_cpa', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.office_role()) = ''cpa'')', t || '_cpa', t);
  end loop;
  foreach t in array shared loop
    continue when to_regclass('public.' || t) is null;
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.office_role()) is not null)', t || '_read', t);
  end loop;
  -- An assistant can see which channels are connected (to publish); only the owner connects or removes them.
  if to_regclass('public.office_social_accounts') is not null then
    drop policy if exists office_social_accounts_work on public.office_social_accounts;
    create policy office_social_accounts_work on public.office_social_accounts for select to authenticated
      using ((select public.office_can_work()));
  end if;
end $$;

-- Storage: the Library for owner + assistant; receipts readable by a CPA --------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    drop policy if exists office_library_admin on storage.objects;
    drop policy if exists office_library_work on storage.objects;
    create policy office_library_work on storage.objects for all to authenticated
      using (bucket_id = 'office-library' and (select public.office_can_work()))
      with check (bucket_id = 'office-library' and (select public.office_can_work()));
    drop policy if exists office_receipts_cpa on storage.objects;
    create policy office_receipts_cpa on storage.objects for select to authenticated
      using (bucket_id = 'receipts' and (select public.office_role()) = 'cpa');
  end if;
end $$;

-- Agents Desk: one row per AI agent run ---------------------------------------------------------------------
create table if not exists public.office_agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent text not null,
  model text,
  ok boolean not null,
  error text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cost_usd numeric(10,4) not null default 0,   -- estimate at list prices
  fell_back boolean not null default false,
  duration_ms int,
  business_id uuid references public.office_businesses(id) on delete set null,
  subject text,                                -- what it worked on, e.g. a content title
  user_id uuid default auth.uid(),             -- null for scheduled jobs
  created_at timestamptz not null default now()
);
create index if not exists office_agent_runs_recent_idx on public.office_agent_runs(created_at desc);
alter table public.office_agent_runs enable row level security;
drop policy if exists office_agent_runs_read on public.office_agent_runs;
create policy office_agent_runs_read on public.office_agent_runs for select to authenticated using ((select public.factory_is_admin()));
drop policy if exists office_agent_runs_log on public.office_agent_runs;
create policy office_agent_runs_log on public.office_agent_runs for insert to authenticated with check ((select public.office_can_work()));
revoke all on public.office_agent_runs from anon;
grant select, insert on public.office_agent_runs to authenticated;

/** AI spend so far this month (Office time zone), for the budget check. Callable by owner and assistant. */
create or replace function public.office_ai_spend_this_month() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_usd), 0) from public.office_agent_runs
   where public.office_can_work()
     and created_at >= date_trunc('month', now() at time zone 'America/New_York') at time zone 'America/New_York'
$$;
revoke all on function public.office_ai_spend_this_month() from public, anon;
grant execute on function public.office_ai_spend_this_month() to authenticated;

-- Settings (owner only) ---------------------------------------------------------------------------------------
create table if not exists public.office_settings (
  key text primary key check (key ~ '^[a-z0-9_]{1,60}$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.office_settings enable row level security;
drop policy if exists office_settings_admin on public.office_settings;
create policy office_settings_admin on public.office_settings for all to authenticated
  using ((select public.factory_is_admin())) with check ((select public.factory_is_admin()));
revoke all on public.office_settings from anon;
grant select, insert, update, delete on public.office_settings to authenticated;

/** The monthly AI budget in dollars (null = no cap). Readable by owner and assistant for the budget check. */
create or replace function public.office_ai_budget() returns numeric
language sql stable security definer set search_path = public as $$
  select case when public.office_can_work() then (select nullif(value #>> '{}', '')::numeric from public.office_settings where key = 'ai_monthly_budget_usd') end
$$;
revoke all on function public.office_ai_budget() from public, anon;
grant execute on function public.office_ai_budget() to authenticated;

-- Phone notifications: Web Push subscriptions, one per device --------------------------------------------------
create table if not exists public.office_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  role text not null check (role in ('owner','assistant','cpa')),
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  device text,
  failures int not null default 0,
  last_ok_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.office_push_subscriptions enable row level security;
drop policy if exists office_push_own on public.office_push_subscriptions;
create policy office_push_own on public.office_push_subscriptions for all to authenticated
  using (user_id = (select auth.uid()) and (select public.office_role()) is not null)
  with check (user_id = (select auth.uid()) and role = (select public.office_role()));
revoke all on public.office_push_subscriptions from anon;
grant select, insert, update, delete on public.office_push_subscriptions to authenticated;

-- Reminders: when the phone was last pinged (email keeps using last_sent_at) ------------------------------------
do $$
begin
  if to_regclass('public.office_reminders') is not null then
    alter table public.office_reminders add column if not exists notified_at timestamptz;
  end if;
end $$;

-- Snoozing a reminder (moving remind_at) lets it ping the phone again.
create or replace function public.office_reminder_renotify() returns trigger language plpgsql as $$
begin
  if new.remind_at is distinct from old.remind_at then new.notified_at := null; end if;
  return new;
end $$;
do $$
begin
  if to_regclass('public.office_reminders') is not null then
    drop trigger if exists office_reminders_renotify on public.office_reminders;
    create trigger office_reminders_renotify before update of remind_at on public.office_reminders
      for each row execute function public.office_reminder_renotify();
  end if;
end $$;
