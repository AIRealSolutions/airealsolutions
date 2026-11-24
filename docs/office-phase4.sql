-- The Office, phase 4: the books for AI Real Solutions LLC.
-- Run after docs/office-phase0..3.sql. Safe to run more than once. All tables are admin-only.
--
-- Design
--  * Double-entry general ledger: acct_journal_entries + acct_journal_lines, amounts in cents.
--  * Every entry must balance (checked at commit) and have at least two lines.
--  * Posted entries are never edited or deleted; corrections are reversing entries.
--  * Entries cannot be dated inside a closed month.
--  * Invoices, payments, bills, expenses and categorized bank transactions post themselves:
--    a deferred trigger compares what the source record should post with what is posted and,
--    if different, reverses the old entry and posts the new one. The books can't drift from the records.
--  * Each journal line carries the business line (venture or client) for per-business P&L.

-- Settings on the entity (mileage rate etc.) ---------------------------------------------------
alter table public.acct_entities add column if not exists settings jsonb not null default '{}'::jsonb;

-- Chart of accounts -----------------------------------------------------------------------------
create table if not exists public.acct_accounts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.acct_entities(id) on delete restrict,
  code text not null check (code ~ '^[0-9]{3,6}$'),
  name text not null check (length(trim(name)) > 0),
  type text not null check (type in ('asset','liability','equity','income','expense')),
  subtype text not null default 'other',
  system_key text,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, code),
  unique (entity_id, system_key)
);

-- Journal ----------------------------------------------------------------------------------------
create table if not exists public.acct_journal_entries (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.acct_entities(id) on delete restrict,
  entry_no bigint generated always as identity,
  entry_date date not null,
  memo text,
  source_type text not null check (source_type in ('manual','invoice','payment','bill','bill_payment','expense','bank_txn')),
  source_id uuid,
  status text not null default 'posted' check (status in ('posted','reversed')),
  reversal_of uuid references public.acct_journal_entries(id),
  reversed_by uuid references public.acct_journal_entries(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists acct_entries_date_idx on public.acct_journal_entries(entity_id, entry_date);
create index if not exists acct_entries_source_idx on public.acct_journal_entries(source_type, source_id);

create table if not exists public.acct_journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.acct_journal_entries(id) on delete restrict,
  account_id uuid not null references public.acct_accounts(id) on delete restrict,
  debit_cents bigint not null default 0 check (debit_cents >= 0),
  credit_cents bigint not null default 0 check (credit_cents >= 0),
  business_id uuid references public.office_businesses(id) on delete set null,
  memo text,
  check ((debit_cents > 0) <> (credit_cents > 0))
);
create index if not exists acct_lines_entry_idx on public.acct_journal_lines(entry_id);
create index if not exists acct_lines_account_idx on public.acct_journal_lines(account_id);

-- Closed months ---------------------------------------------------------------------------------
create table if not exists public.acct_periods (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.acct_entities(id) on delete restrict,
  period_start date not null check (extract(day from period_start) = 1),
  status text not null default 'closed' check (status in ('open','closed')),
  closed_at timestamptz,
  closed_by uuid,
  notes text,
  updated_at timestamptz not null default now(),
  unique (entity_id, period_start)
);

-- Bills (money owed) and expenses (already paid) ------------------------------------------------------
create table if not exists public.acct_bills (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.acct_entities(id) on delete restrict,
  vendor text not null check (length(trim(vendor)) > 0),
  bill_date date not null,
  due_date date,
  amount_cents bigint not null check (amount_cents > 0),
  expense_account_id uuid not null references public.acct_accounts(id),
  business_id uuid references public.office_businesses(id) on delete set null,
  memo text,
  receipt_path text,
  status text not null default 'open' check (status in ('open','paid','void')),
  paid_on date,
  paid_from_account_id uuid references public.acct_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'paid' or (paid_on is not null and paid_from_account_id is not null))
);
create index if not exists acct_bills_status_idx on public.acct_bills(entity_id, status, due_date);

create table if not exists public.acct_expenses (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.acct_entities(id) on delete restrict,
  vendor text not null check (length(trim(vendor)) > 0),
  spent_on date not null,
  amount_cents bigint not null check (amount_cents > 0),
  expense_account_id uuid not null references public.acct_accounts(id),
  paid_from_account_id uuid not null references public.acct_accounts(id),
  business_id uuid references public.office_businesses(id) on delete set null,
  memo text,
  receipt_path text,
  mileage_miles numeric(9,1),
  source text not null default 'manual' check (source in ('manual','receipt','mileage')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists acct_expenses_date_idx on public.acct_expenses(entity_id, spent_on desc);

-- Banking --------------------------------------------------------------------------------------
create table if not exists public.acct_bank_connections (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.acct_entities(id) on delete restrict,
  provider text not null default 'plaid' check (provider in ('plaid')),
  institution_name text,
  item_id text unique,
  access_token_ciphertext text,        -- encrypted with INTEGRATIONS_ENCRYPTION_KEY on the server
  sync_cursor text,
  status text not null default 'active' check (status in ('active','error','removed')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.acct_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.acct_entities(id) on delete restrict,
  connection_id uuid references public.acct_bank_connections(id) on delete set null,
  ledger_account_id uuid not null references public.acct_accounts(id),
  plaid_account_id text unique,
  name text not null,
  mask text,
  kind text not null default 'bank' check (kind in ('bank','credit_card')),
  current_balance_cents bigint,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.acct_bank_txns (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.acct_entities(id) on delete restrict,
  bank_account_id uuid not null references public.acct_bank_accounts(id) on delete restrict,
  posted_on date not null,
  amount_cents bigint not null check (amount_cents <> 0),   -- + money in, - money out
  description text not null default '',
  merchant text,
  plaid_category text,
  pending boolean not null default false,
  status text not null default 'new' check (status in ('new','categorized','matched','excluded')),
  category_account_id uuid references public.acct_accounts(id),
  business_id uuid references public.office_businesses(id) on delete set null,
  memo text,
  matched_type text check (matched_type is null or matched_type in ('payment','bill','expense')),
  matched_id uuid,
  suggested_account_id uuid references public.acct_accounts(id) on delete set null,
  suggested_business_id uuid references public.office_businesses(id) on delete set null,
  suggestion_source text check (suggestion_source is null or suggestion_source in ('rule','ai')),
  suggestion_note text,
  plaid_txn_id text unique,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'categorized' or category_account_id is not null)
);
create index if not exists acct_bank_txns_queue_idx on public.acct_bank_txns(entity_id, status, posted_on desc);

create table if not exists public.acct_rules (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.acct_entities(id) on delete restrict,
  match_text text not null check (length(trim(match_text)) >= 3),
  account_id uuid not null references public.acct_accounts(id) on delete cascade,
  business_id uuid references public.office_businesses(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (entity_id, match_text)
);

-- Billing additions: which income account a product earns into; where a payment was deposited.
alter table public.bill_products add column if not exists income_account_id uuid references public.acct_accounts(id);
alter table public.bill_payments add column if not exists deposit_account_id uuid references public.acct_accounts(id);

-- updated_at, RLS, grants -----------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['acct_accounts','acct_periods','acct_bills','acct_expenses','acct_bank_connections','acct_bank_accounts','acct_bank_txns'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.office_touch_updated_at()', t || '_touch', t);
  end loop;
  foreach t in array array['acct_accounts','acct_journal_entries','acct_journal_lines','acct_periods','acct_bills','acct_expenses','acct_bank_connections','acct_bank_accounts','acct_bank_txns','acct_rules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
  -- Journal: admins read it; writes only through the posting functions below.
  foreach t in array array['acct_journal_entries','acct_journal_lines'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select public.factory_is_admin()))', t || '_admin', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  foreach t in array array['acct_accounts','acct_periods','acct_bills','acct_expenses','acct_bank_connections','acct_bank_accounts','acct_bank_txns','acct_rules'] loop
    execute format('create policy %I on public.%I for all to authenticated using ((select public.factory_is_admin())) with check ((select public.factory_is_admin()))', t || '_admin', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Ledger rules enforced in the database -------------------------------------------------------------
create or replace function public.acct__today() returns date language sql stable set search_path = '' as
$$ select (now() at time zone 'America/New_York')::date $$;

create or replace function public.acct__is_closed(p_entity uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.acct_periods p where p.entity_id = p_entity and p.status = 'closed'
                  and p.period_start = date_trunc('month', p_date)::date);
$$;

create or replace function public.acct__guard_entry() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Journal entries are never deleted. Reverse the entry instead.';
  elsif tg_op = 'INSERT' then
    if public.acct__is_closed(new.entity_id, new.entry_date) then
      raise exception 'The books for % are closed. Reopen that month first, or date the entry in an open month.', to_char(new.entry_date, 'FMMonth YYYY');
    end if;
  elsif tg_op = 'UPDATE' then
    if new.entity_id <> old.entity_id or new.entry_date <> old.entry_date or new.source_type <> old.source_type
       or new.source_id is distinct from old.source_id or new.reversal_of is distinct from old.reversal_of
       or (old.status = 'reversed' and new.status <> 'reversed') then
      raise exception 'Posted journal entries cannot be changed. Reverse the entry instead.';
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists acct_entries_guard on public.acct_journal_entries;
create trigger acct_entries_guard before insert or update or delete on public.acct_journal_entries
  for each row execute function public.acct__guard_entry();

create or replace function public.acct__guard_line() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Posted journal lines cannot be changed. Reverse the entry instead.';
end $$;
drop trigger if exists acct_lines_guard on public.acct_journal_lines;
create trigger acct_lines_guard before update or delete on public.acct_journal_lines
  for each row execute function public.acct__guard_line();

-- Every entry balances and has at least two lines (checked at commit, once all lines are in).
create or replace function public.acct__check_balance() returns trigger
language plpgsql set search_path = '' as $$
declare d bigint; c bigint; n int;
begin
  select coalesce(sum(debit_cents),0), coalesce(sum(credit_cents),0), count(*) into d, c, n
    from public.acct_journal_lines where entry_id = new.entry_id;
  if n < 2 or d <> c then
    raise exception 'Journal entry does not balance (debits %, credits %, % lines).', d, c, n;
  end if;
  return null;
end $$;
drop trigger if exists acct_lines_balance on public.acct_journal_lines;
create constraint trigger acct_lines_balance after insert on public.acct_journal_lines
  deferrable initially deferred for each row execute function public.acct__check_balance();

-- Posting core (internal) ------------------------------------------------------------------------------
create or replace function public.acct__sys(p_entity uuid, p_key text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare a uuid;
begin
  select id into a from public.acct_accounts where entity_id = p_entity and system_key = p_key;
  if a is null then raise exception 'Missing system account "%". Re-run docs/office-phase4.sql.', p_key; end if;
  return a;
end $$;

-- p_lines: [{"account_id": "...", "debit": 100, "credit": 0, "business_id": null, "memo": null}, ...]
create or replace function public.acct__post(p_entity uuid, p_date date, p_memo text, p_source_type text, p_source_id uuid, p_lines jsonb, p_reversal_of uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e uuid; l jsonb;
begin
  insert into public.acct_journal_entries (entity_id, entry_date, memo, source_type, source_id, reversal_of)
  values (p_entity, p_date, p_memo, p_source_type, p_source_id, p_reversal_of) returning id into e;
  for l in select * from jsonb_array_elements(p_lines) loop
    if coalesce((l->>'debit')::bigint, 0) > 0 or coalesce((l->>'credit')::bigint, 0) > 0 then
      insert into public.acct_journal_lines (entry_id, account_id, debit_cents, credit_cents, business_id, memo)
      values (e, (l->>'account_id')::uuid, coalesce((l->>'debit')::bigint, 0), coalesce((l->>'credit')::bigint, 0),
              nullif(l->>'business_id', '')::uuid, nullif(l->>'memo', ''));
    end if;
  end loop;
  return e;
end $$;

create or replace function public.acct__reverse(p_entry uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare e public.acct_journal_entries; r uuid; d date;
begin
  select * into e from public.acct_journal_entries where id = p_entry for update;
  if e.status <> 'posted' or e.reversal_of is not null then return null; end if;
  -- Reverse on the original date while that month is open, otherwise today.
  d := case when public.acct__is_closed(e.entity_id, e.entry_date) then public.acct__today() else e.entry_date end;
  r := public.acct__post(e.entity_id, d, 'Reversal of #' || e.entry_no || coalesce(': ' || e.memo, ''), e.source_type, e.source_id,
        (select coalesce(jsonb_agg(jsonb_build_object('account_id', account_id, 'debit', credit_cents, 'credit', debit_cents, 'business_id', business_id, 'memo', memo)), '[]'::jsonb)
           from public.acct_journal_lines where entry_id = e.id), e.id);
  update public.acct_journal_entries set status = 'reversed', reversed_by = r where id = e.id;
  return r;
end $$;

-- Make the ledger match what a source record should post. p_lines empty = nothing should be posted.
create or replace function public.acct__sync_source(p_entity uuid, p_date date, p_memo text, p_source_type text, p_source_id uuid, p_lines jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare want jsonb; have jsonb; have_date date; x record;
begin
  select coalesce(jsonb_agg(jsonb_build_object('a', a, 'b', b, 'n', n) order by a, b), '[]'::jsonb) into want from (
    select l->>'account_id' as a, coalesce(nullif(l->>'business_id',''), '-') as b,
           sum(coalesce((l->>'debit')::bigint,0) - coalesce((l->>'credit')::bigint,0)) as n
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l group by 1, 2) s where n <> 0;
  select coalesce(jsonb_agg(jsonb_build_object('a', a, 'b', b, 'n', n) order by a, b), '[]'::jsonb) into have from (
    select jl.account_id::text as a, coalesce(jl.business_id::text, '-') as b, sum(jl.debit_cents - jl.credit_cents) as n
      from public.acct_journal_lines jl join public.acct_journal_entries je on je.id = jl.entry_id
     where je.source_type = p_source_type and je.source_id = p_source_id group by 1, 2) s where n <> 0;
  select max(entry_date) into have_date from public.acct_journal_entries
   where source_type = p_source_type and source_id = p_source_id and status = 'posted' and reversal_of is null;

  if want = have and (want = '[]'::jsonb or have_date = p_date) then return; end if;

  for x in select id from public.acct_journal_entries
            where source_type = p_source_type and source_id = p_source_id and status = 'posted' and reversal_of is null loop
    perform public.acct__reverse(x.id);
  end loop;
  if want <> '[]'::jsonb then
    perform public.acct__post(p_entity, p_date, p_memo, p_source_type, p_source_id, p_lines);
  end if;
end $$;

-- What each kind of record posts -------------------------------------------------------------------
create or replace function public.acct__sync_invoice(p_id uuid, p_entity uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i record; lines jsonb := '[]'::jsonb;
begin
  select bi.*, bc.name as customer_name into i from public.bill_invoices bi join public.bill_customers bc on bc.id = bi.customer_id where bi.id = p_id;
  if found and i.kind = 'invoice' and i.status in ('sent','partial','paid') and i.total_cents > 0 then
    lines := jsonb_build_array(jsonb_build_object('account_id', public.acct__sys(i.entity_id, 'ar'), 'debit', i.total_cents, 'business_id', i.business_id))
      || coalesce((select jsonb_agg(jsonb_build_object('account_id', acc, 'credit', amt, 'business_id', i.business_id))
                     from (select coalesce(p.income_account_id, public.acct__sys(i.entity_id, 'sales')) as acc, sum(l.amount_cents) as amt
                             from public.bill_invoice_lines l left join public.bill_products p on p.id = l.product_id
                            where l.invoice_id = i.id group by 1) s), '[]'::jsonb);
    if i.tax_cents > 0 then
      lines := lines || jsonb_build_array(jsonb_build_object('account_id', public.acct__sys(i.entity_id, 'sales_tax'), 'credit', i.tax_cents, 'business_id', i.business_id));
    end if;
  end if;
  perform public.acct__sync_source(coalesce(i.entity_id, p_entity), i.issue_date, 'Invoice ' || i.number || ' — ' || i.customer_name, 'invoice', p_id, lines);
end $$;

create or replace function public.acct__sync_payment(p_id uuid, p_entity uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p record; lines jsonb := '[]'::jsonb; cash uuid;
begin
  select bp.*, bi.number, bi.business_id into p from public.bill_payments bp join public.bill_invoices bi on bi.id = bp.invoice_id where bp.id = p_id;
  if found then
    cash := coalesce(p.deposit_account_id, case when p.method = 'stripe' then public.acct__sys(p.entity_id, 'stripe_clearing') else public.acct__sys(p.entity_id, 'checking') end);
    lines := jsonb_build_array(
      jsonb_build_object('account_id', cash, 'debit', p.amount_cents, 'business_id', p.business_id),
      jsonb_build_object('account_id', public.acct__sys(p.entity_id, 'ar'), 'credit', p.amount_cents, 'business_id', p.business_id));
  end if;
  perform public.acct__sync_source(coalesce(p.entity_id, p_entity), p.received_on, 'Payment on ' || p.number || ' (' || p.method || ')', 'payment', p_id, lines);
end $$;

create or replace function public.acct__sync_bill(p_id uuid, p_entity uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.acct_bills; l1 jsonb := '[]'::jsonb; l2 jsonb := '[]'::jsonb;
begin
  select * into b from public.acct_bills where id = p_id;
  if found and b.status in ('open','paid') then
    l1 := jsonb_build_array(
      jsonb_build_object('account_id', b.expense_account_id, 'debit', b.amount_cents, 'business_id', b.business_id),
      jsonb_build_object('account_id', public.acct__sys(b.entity_id, 'ap'), 'credit', b.amount_cents, 'business_id', b.business_id));
    if b.status = 'paid' then
      l2 := jsonb_build_array(
        jsonb_build_object('account_id', public.acct__sys(b.entity_id, 'ap'), 'debit', b.amount_cents, 'business_id', b.business_id),
        jsonb_build_object('account_id', b.paid_from_account_id, 'credit', b.amount_cents, 'business_id', b.business_id));
    end if;
  end if;
  perform public.acct__sync_source(coalesce(b.entity_id, p_entity), b.bill_date, 'Bill: ' || b.vendor, 'bill', p_id, l1);
  perform public.acct__sync_source(coalesce(b.entity_id, p_entity), b.paid_on, 'Paid bill: ' || b.vendor, 'bill_payment', p_id, l2);
end $$;

create or replace function public.acct__sync_expense(p_id uuid, p_entity uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.acct_expenses; lines jsonb := '[]'::jsonb;
begin
  select * into x from public.acct_expenses where id = p_id;
  if found then
    lines := jsonb_build_array(
      jsonb_build_object('account_id', x.expense_account_id, 'debit', x.amount_cents, 'business_id', x.business_id, 'memo', x.memo),
      jsonb_build_object('account_id', x.paid_from_account_id, 'credit', x.amount_cents, 'business_id', x.business_id));
  end if;
  perform public.acct__sync_source(coalesce(x.entity_id, p_entity), x.spent_on, 'Expense: ' || x.vendor, 'expense', p_id, lines);
end $$;

create or replace function public.acct__sync_bank_txn(p_id uuid, p_entity uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t record; lines jsonb := '[]'::jsonb; amt bigint;
begin
  select bt.*, ba.ledger_account_id into t from public.acct_bank_txns bt join public.acct_bank_accounts ba on ba.id = bt.bank_account_id where bt.id = p_id;
  if found and t.status = 'categorized' and not t.pending then
    amt := abs(t.amount_cents);
    if t.amount_cents > 0 then
      lines := jsonb_build_array(
        jsonb_build_object('account_id', t.ledger_account_id, 'debit', amt, 'business_id', t.business_id),
        jsonb_build_object('account_id', t.category_account_id, 'credit', amt, 'business_id', t.business_id, 'memo', t.memo));
    else
      lines := jsonb_build_array(
        jsonb_build_object('account_id', t.category_account_id, 'debit', amt, 'business_id', t.business_id, 'memo', t.memo),
        jsonb_build_object('account_id', t.ledger_account_id, 'credit', amt, 'business_id', t.business_id));
    end if;
  end if;
  perform public.acct__sync_source(coalesce(t.entity_id, p_entity), t.posted_on, left('Bank: ' || coalesce(t.merchant, t.description), 200), 'bank_txn', p_id, lines);
end $$;

-- Deferred triggers: run once at commit, after all of a request's changes.
create or replace function public.acct__on_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare rid uuid := coalesce(new.id, old.id); ent uuid := coalesce(new.entity_id, old.entity_id);
begin
  case tg_table_name
    when 'bill_invoices' then perform public.acct__sync_invoice(rid, ent);
    when 'bill_payments' then perform public.acct__sync_payment(rid, ent);
    when 'acct_bills' then perform public.acct__sync_bill(rid, ent);
    when 'acct_expenses' then perform public.acct__sync_expense(rid, ent);
    when 'acct_bank_txns' then perform public.acct__sync_bank_txn(rid, ent);
  end case;
  return null;
end $$;

-- Lines changing re-posts their invoice.
create or replace function public.acct__on_invoice_line() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  perform public.acct__sync_invoice(inv, (select entity_id from public.bill_invoices where id = inv));
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['bill_invoices','bill_payments','acct_bills','acct_expenses','acct_bank_txns'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_post', t);
    execute format('create constraint trigger %I after insert or update or delete on public.%I deferrable initially deferred for each row execute function public.acct__on_change()', t || '_post', t);
  end loop;
end $$;
drop trigger if exists bill_invoice_lines_post on public.bill_invoice_lines;
create constraint trigger bill_invoice_lines_post after insert or update or delete on public.bill_invoice_lines
  deferrable initially deferred for each row execute function public.acct__on_invoice_line();

-- Source records with posted entries keep their entity; payments can't be deleted from a closed month by the guard above.

-- Admin functions (called from the Office) ------------------------------------------------------------
create or replace function public.acct_post_manual(p_entity uuid, p_date date, p_memo text, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a uuid; bad int;
begin
  if not public.factory_is_admin() then raise exception 'Admin access required.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then raise exception 'An entry needs at least two lines.'; end if;
  select count(*) into bad from jsonb_array_elements(p_lines) l
   where not exists (select 1 from public.acct_accounts x where x.id = (l->>'account_id')::uuid and x.entity_id = p_entity);
  if bad > 0 then raise exception 'Every line needs an account from these books.'; end if;
  a := public.acct__post(p_entity, p_date, nullif(trim(p_memo), ''), 'manual', null, p_lines);
  return a;
end $$;

create or replace function public.acct_reverse_entry(p_entry uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  if not public.factory_is_admin() then raise exception 'Admin access required.'; end if;
  select source_type into st from public.acct_journal_entries where id = p_entry;
  if st is null then raise exception 'Entry not found.'; end if;
  if st <> 'manual' then raise exception 'This entry comes from a % record. Change or void that record instead.', replace(st, '_', ' '); end if;
  return public.acct__reverse(p_entry);
end $$;

-- Replace an invoice's lines in one transaction (one repost instead of one per line).
create or replace function public.bill_replace_lines(p_invoice uuid, p_lines jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.bill_invoice_lines where invoice_id = p_invoice;
  insert into public.bill_invoice_lines (invoice_id, product_id, description, quantity, unit_price_cents, sort_order)
  select p_invoice, nullif(l->>'product_id','')::uuid, l->>'description', (l->>'quantity')::numeric, (l->>'unit_price_cents')::bigint, (ord - 1)::int
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(l, ord);
end $$;

-- Reports (RLS applies: invoker) ---------------------------------------------------------------------
-- Balances by account for a date range; p_from null = since the beginning. Reversals net out on their own.
create or replace function public.acct_balances(p_entity uuid, p_from date, p_to date, p_business uuid default null)
returns table (account_id uuid, code text, name text, type text, subtype text, debit_cents bigint, credit_cents bigint, balance_cents bigint)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.code, a.name, a.type, a.subtype,
         coalesce(sum(l.debit_cents), 0)::bigint, coalesce(sum(l.credit_cents), 0)::bigint,
         (case when a.type in ('asset','expense') then coalesce(sum(l.debit_cents - l.credit_cents), 0)
               else coalesce(sum(l.credit_cents - l.debit_cents), 0) end)::bigint
    from public.acct_accounts a
    left join (public.acct_journal_lines l join public.acct_journal_entries e on e.id = l.entry_id
               and (p_from is null or e.entry_date >= p_from) and e.entry_date <= p_to)
      on l.account_id = a.id and (p_business is null or l.business_id = p_business)
   where a.entity_id = p_entity
   group by a.id order by a.code;
$$;

-- Income and expense by business line for a date range.
create or replace function public.acct_pl_by_business(p_entity uuid, p_from date, p_to date)
returns table (business_id uuid, account_id uuid, amount_cents bigint)
language sql stable security invoker set search_path = '' as $$
  select l.business_id, a.id,
         sum(case when a.type = 'income' then l.credit_cents - l.debit_cents else l.debit_cents - l.credit_cents end)::bigint
    from public.acct_journal_lines l join public.acct_journal_entries e on e.id = l.entry_id
    join public.acct_accounts a on a.id = l.account_id
   where e.entity_id = p_entity and e.entry_date between p_from and p_to and a.type in ('income','expense')
   group by 1, 2;
$$;

-- Money in and out of bank accounts by month.
create or replace function public.acct_cash_by_month(p_entity uuid, p_from date, p_to date)
returns table (month date, money_in_cents bigint, money_out_cents bigint)
language sql stable security invoker set search_path = '' as $$
  select date_trunc('month', e.entry_date)::date, sum(l.debit_cents)::bigint, sum(l.credit_cents)::bigint
    from public.acct_journal_lines l join public.acct_journal_entries e on e.id = l.entry_id
    join public.acct_accounts a on a.id = l.account_id
   where e.entity_id = p_entity and a.subtype = 'bank' and e.entry_date between p_from and p_to
     and e.status = 'posted' and e.reversal_of is null
   group by 1 order by 1;
$$;

revoke all on function public.acct__sys(uuid,text), public.acct__post(uuid,date,text,text,uuid,jsonb,uuid), public.acct__reverse(uuid),
  public.acct__sync_source(uuid,date,text,text,uuid,jsonb), public.acct__sync_invoice(uuid,uuid), public.acct__sync_payment(uuid,uuid),
  public.acct__sync_bill(uuid,uuid), public.acct__sync_expense(uuid,uuid), public.acct__sync_bank_txn(uuid,uuid),
  public.acct__on_change(), public.acct__on_invoice_line(), public.acct__is_closed(uuid,date),
  public.acct__guard_entry(), public.acct__guard_line(), public.acct__check_balance() from public, anon, authenticated;
revoke all on function public.acct_post_manual(uuid,date,text,jsonb), public.acct_reverse_entry(uuid), public.bill_replace_lines(uuid,jsonb),
  public.acct_balances(uuid,date,date,uuid), public.acct_pl_by_business(uuid,date,date), public.acct_cash_by_month(uuid,date,date) from public, anon;
grant execute on function public.acct_post_manual(uuid,date,text,jsonb), public.acct_reverse_entry(uuid), public.bill_replace_lines(uuid,jsonb),
  public.acct_balances(uuid,date,date,uuid), public.acct_pl_by_business(uuid,date,date), public.acct_cash_by_month(uuid,date,date) to authenticated, service_role;

-- Starting chart of accounts for a software & services LLC ----------------------------------------------
insert into public.acct_accounts (entity_id, code, name, type, subtype, system_key)
select e.id, a.code, a.name, a.type, a.subtype, a.system_key
from public.acct_entities e, (values
  ('1000','Business checking','asset','bank','checking'),
  ('1050','Stripe clearing','asset','clearing','stripe_clearing'),
  ('1100','Accounts receivable','asset','receivable','ar'),
  ('1500','Computer equipment','asset','fixed_asset',null),
  ('2000','Accounts payable','liability','payable','ap'),
  ('2100','Business credit card','liability','credit_card','credit_card'),
  ('2200','Sales tax payable','liability','tax','sales_tax'),
  ('2500','Loans payable','liability','loan',null),
  ('3000','Owner contributions','equity','owner','owner_equity'),
  ('3050','Opening balance equity','equity','opening','opening_equity'),
  ('3100','Owner draws','equity','owner_draw','owner_draw'),
  ('3900','Retained earnings','equity','retained','retained_earnings'),
  ('4000','Software development revenue','income','revenue','sales'),
  ('4100','Subscriptions & hosting revenue','income','revenue',null),
  ('4200','Consulting revenue','income','revenue',null),
  ('4900','Other income','income','other_income','uncategorized_income'),
  ('5000','Hosting & infrastructure','expense','cost_of_sales',null),
  ('5100','AI & API usage','expense','cost_of_sales',null),
  ('5200','Software subscriptions','expense','expense',null),
  ('5300','Contractors','expense','contractor',null),
  ('6000','Advertising & marketing','expense','expense',null),
  ('6100','Bank & payment processing fees','expense','expense','fees'),
  ('6200','Meals (business)','expense','expense',null),
  ('6300','Office supplies','expense','expense',null),
  ('6400','Legal & professional fees','expense','expense',null),
  ('6500','Domains & websites','expense','expense',null),
  ('6600','Vehicle & mileage','expense','expense','mileage'),
  ('6650','Travel','expense','expense',null),
  ('6700','Insurance','expense','expense',null),
  ('6800','Licenses, permits & fees','expense','expense',null),
  ('6900','Phone & internet','expense','expense',null),
  ('6950','Education & training','expense','expense',null),
  ('6999','Uncategorized expense','expense','expense','uncategorized_expense')
) as a(code, name, type, subtype, system_key)
where e.legal_name = 'AI Real Solutions LLC'
on conflict (entity_id, code) do nothing;

update public.acct_entities set settings = settings || '{"mileage_rate_cents": 70}'::jsonb
 where legal_name = 'AI Real Solutions LLC' and not (settings ? 'mileage_rate_cents');

-- Private storage for receipts (Supabase Storage), admin-only ---------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('receipts', 'receipts', false, 10485760, array['image/jpeg','image/png','image/webp','image/gif','image/heic','application/pdf'])
    on conflict (id) do nothing;
    drop policy if exists office_receipts_admin on storage.objects;
    create policy office_receipts_admin on storage.objects for all to authenticated
      using (bucket_id = 'receipts' and (select public.factory_is_admin()))
      with check (bucket_id = 'receipts' and (select public.factory_is_admin()));
  end if;
end $$;

-- Back-fill the books from billing records that already exist ------------------------------------------------
do $$
declare r record;
begin
  for r in select id, entity_id from public.bill_invoices where kind = 'invoice' loop perform public.acct__sync_invoice(r.id, r.entity_id); end loop;
  for r in select id, entity_id from public.bill_payments loop perform public.acct__sync_payment(r.id, r.entity_id); end loop;
end $$;
