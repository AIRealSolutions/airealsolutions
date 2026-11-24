-- The Office, phase 3: invoicing and billing for AI Real Solutions LLC.
-- Run after docs/office-phase0.sql and office-phase1.sql. Safe to run more than once. All tables are admin-only.
-- Money is stored in whole cents. Posting to the books (journal entries) arrives with phase 4 and will
-- be back-filled from these invoices and payments.

-- Seller details printed on invoices ------------------------------------------------
alter table public.acct_entities add column if not exists billing_profile jsonb not null default '{}'::jsonb;
-- {"address": "...", "email": "...", "phone": "...", "payment_terms_days": 15, "payment_instructions": "...", "footer": "..."}

-- Customers -----------------------------------------------------------------------------
create table if not exists public.bill_customers (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.acct_entities(id) on delete restrict,
  business_id uuid references public.office_businesses(id) on delete set null,   -- the client business record, if any
  name text not null check (length(trim(name)) > 0),
  email text,
  phone text,
  billing_address text,
  notes text,
  stripe_customer_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bill_customers_entity_idx on public.bill_customers(entity_id, active);

-- Products and services (price list) -------------------------------------------------------
create table if not exists public.bill_products (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.acct_entities(id) on delete restrict,
  business_id uuid references public.office_businesses(id) on delete set null,   -- which line of business earns it
  name text not null check (length(trim(name)) > 0),
  description text,
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0),
  unit text not null default 'each',
  recurring_interval text check (recurring_interval is null or recurring_interval in ('month','year')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Invoices and quotes -----------------------------------------------------------------------
create table if not exists public.bill_invoices (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.acct_entities(id) on delete restrict,
  customer_id uuid not null references public.bill_customers(id) on delete restrict,
  business_id uuid references public.office_businesses(id) on delete set null,
  kind text not null default 'invoice' check (kind in ('invoice','quote')),
  number text unique,
  status text not null default 'draft'
    check (status in ('draft','sent','partial','paid','void','accepted','declined','expired')),
  issue_date date not null default ((now() at time zone 'America/New_York')::date),
  due_date date,
  memo text,
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0,
  paid_cents bigint not null default 0,
  balance_cents bigint generated always as (total_cents - paid_cents) stored,
  public_token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  stripe_session_id text,
  subscription_id uuid,
  converted_from uuid references public.bill_invoices(id) on delete set null,
  dunning_stage smallint not null default 0,
  sent_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bill_invoices_status_idx on public.bill_invoices(kind, status, due_date);
create index if not exists bill_invoices_customer_idx on public.bill_invoices(customer_id);

create table if not exists public.bill_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.bill_invoices(id) on delete cascade,
  product_id uuid references public.bill_products(id) on delete set null,
  description text not null default '',
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit_price_cents bigint not null default 0 check (unit_price_cents >= 0),
  amount_cents bigint generated always as (round(quantity * unit_price_cents)::bigint) stored,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists bill_invoice_lines_invoice_idx on public.bill_invoice_lines(invoice_id, sort_order);

-- Payments --------------------------------------------------------------------------------
create table if not exists public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.acct_entities(id) on delete restrict,
  invoice_id uuid not null references public.bill_invoices(id) on delete restrict,
  customer_id uuid not null references public.bill_customers(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  method text not null check (method in ('stripe','ach','check','wire','cash','other')),
  received_on date not null default ((now() at time zone 'America/New_York')::date),
  reference text,
  stripe_payment_ref text unique,   -- Stripe payment intent / session: makes webhook retries harmless
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists bill_payments_invoice_idx on public.bill_payments(invoice_id);

-- Recurring billing ------------------------------------------------------------------------
create table if not exists public.bill_subscriptions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.acct_entities(id) on delete restrict,
  customer_id uuid not null references public.bill_customers(id) on delete restrict,
  business_id uuid references public.office_businesses(id) on delete set null,
  name text not null,
  interval text not null check (interval in ('month','year')),
  next_invoice_on date not null,
  days_until_due integer not null default 15 check (days_until_due between 0 and 120),
  lines jsonb not null default '[]'::jsonb,   -- [{product_id, description, quantity, unit_price_cents}]
  auto_send boolean not null default false,
  status text not null default 'active' check (status in ('active','paused','canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bill_invoices_subscription_fk') then
    alter table public.bill_invoices add constraint bill_invoices_subscription_fk
      foreign key (subscription_id) references public.bill_subscriptions(id) on delete set null;
  end if;
end $$;

-- Invoice numbers: INV-2026-0001, Q-2026-0001 --------------------------------------------------
create table if not exists public.bill_counters (key text primary key, value integer not null default 0);

create or replace function public.bill_assign_number() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text; n integer;
begin
  if new.number is null then
    k := (case new.kind when 'quote' then 'Q' else 'INV' end) || '-' || extract(year from new.issue_date)::int;
    insert into public.bill_counters (key, value) values (k, 1)
      on conflict (key) do update set value = public.bill_counters.value + 1
      returning value into n;
    new.number := k || '-' || lpad(n::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists bill_invoices_number on public.bill_invoices;
create trigger bill_invoices_number before insert on public.bill_invoices
  for each row execute function public.bill_assign_number();

-- Totals and status follow the lines and payments -------------------------------------------
create or replace function public.bill_recalc(p_invoice uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare sub bigint; paid bigint; inv public.bill_invoices;
begin
  select coalesce(sum(amount_cents), 0) into sub from public.bill_invoice_lines where invoice_id = p_invoice;
  select coalesce(sum(amount_cents), 0) into paid from public.bill_payments where invoice_id = p_invoice;
  update public.bill_invoices set subtotal_cents = sub, total_cents = sub + tax_cents, paid_cents = paid
   where id = p_invoice returning * into inv;
  if inv.kind = 'invoice' and inv.status <> 'void' then
    update public.bill_invoices set
      status = case when inv.total_cents > 0 and paid >= inv.total_cents then 'paid'
                    when paid > 0 then 'partial'
                    when inv.status in ('paid','partial') then 'sent'
                    else inv.status end,
      paid_at = case when inv.total_cents > 0 and paid >= inv.total_cents then coalesce(inv.paid_at, now()) else null end
     where id = p_invoice;
  end if;
end $$;

create or replace function public.bill_recalc_trigger() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  perform public.bill_recalc(coalesce(new.invoice_id, old.invoice_id));
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then perform public.bill_recalc(old.invoice_id); end if;
  return null;
end $$;
drop trigger if exists bill_lines_recalc on public.bill_invoice_lines;
create trigger bill_lines_recalc after insert or update or delete on public.bill_invoice_lines
  for each row execute function public.bill_recalc_trigger();
drop trigger if exists bill_payments_recalc on public.bill_payments;
create trigger bill_payments_recalc after insert or update or delete on public.bill_payments
  for each row execute function public.bill_recalc_trigger();

-- Tax changes re-total the invoice.
create or replace function public.bill_tax_retotal() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.total_cents := new.subtotal_cents + new.tax_cents;
  return new;
end $$;
drop trigger if exists bill_invoices_tax on public.bill_invoices;
create trigger bill_invoices_tax before update of tax_cents on public.bill_invoices
  for each row execute function public.bill_tax_retotal();

-- updated_at, RLS, grants -------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['bill_customers','bill_products','bill_invoices','bill_subscriptions'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.office_touch_updated_at()', t || '_touch', t);
  end loop;
  foreach t in array array['bill_customers','bill_products','bill_invoices','bill_invoice_lines','bill_payments','bill_subscriptions','bill_counters'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.factory_is_admin())) with check ((select public.factory_is_admin()))', t || '_admin', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

revoke all on function public.bill_assign_number(), public.bill_recalc_trigger(), public.bill_tax_retotal() from public, anon, authenticated;
revoke all on function public.bill_recalc(uuid) from public, anon;
grant execute on function public.bill_recalc(uuid) to authenticated, service_role;

-- Starting price list from the Factory's plans and add-ons is left to you; seed the seller profile.
update public.acct_entities
   set billing_profile = jsonb_build_object('payment_terms_days', 15, 'payment_instructions', 'Pay online with the link on this invoice (card or bank transfer).')
 where legal_name = 'AI Real Solutions LLC' and billing_profile = '{}'::jsonb;
