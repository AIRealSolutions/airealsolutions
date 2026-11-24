-- The Office, phase 5: CRM for AI Real Solutions LLC and its ventures.
-- Run after docs/office-phase0..4.sql. Safe to run more than once. All tables are admin-only;
-- website leads are written by the server with the service role.

create table if not exists public.office_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  website text,
  phone text,
  notes text,
  bill_customer_id uuid references public.bill_customers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.office_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text,
  title text,
  company_id uuid references public.office_companies(id) on delete set null,
  notes text,
  source text,
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists office_contacts_email_key on public.office_contacts (lower(email)) where email is not null;
create index if not exists office_contacts_company_idx on public.office_contacts(company_id);

-- A person can matter to several businesses (a CemeteryBuilder prospect and an ARS client).
create table if not exists public.office_contact_businesses (
  contact_id uuid not null references public.office_contacts(id) on delete cascade,
  business_id uuid not null references public.office_businesses(id) on delete cascade,
  role text not null default 'prospect' check (role in ('lead','prospect','client','partner','vendor','other')),
  created_at timestamptz not null default now(),
  primary key (contact_id, business_id)
);

-- Pipelines: stages are [{"key":"lead","label":"Lead","kind":"open"}, ...]; kind is open | won | lost.
create table if not exists public.office_pipelines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.office_businesses(id) on delete cascade,
  name text not null,
  stages jsonb not null,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(stages) = 'array' and jsonb_array_length(stages) >= 2)
);

create table if not exists public.office_deals (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.office_pipelines(id) on delete restrict,
  business_id uuid references public.office_businesses(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  contact_id uuid references public.office_contacts(id) on delete set null,
  company_id uuid references public.office_companies(id) on delete set null,
  stage text not null,
  status text not null default 'open' check (status in ('open','won','lost')),
  value_cents bigint not null default 0 check (value_cents >= 0),
  recurring_cents bigint not null default 0 check (recurring_cents >= 0),
  expected_close date,
  next_step text,
  next_step_on date,
  lost_reason text,
  source text,
  invoice_id uuid references public.bill_invoices(id) on delete set null,
  factory_project_id uuid references public.factory_projects(id) on delete set null,
  last_activity_at timestamptz,
  reminded_on date,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists office_deals_board_idx on public.office_deals(pipeline_id, status, stage);
create index if not exists office_deals_contact_idx on public.office_deals(contact_id);

create table if not exists public.office_activities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references public.office_contacts(id) on delete cascade,
  company_id uuid references public.office_companies(id) on delete cascade,
  deal_id uuid references public.office_deals(id) on delete cascade,
  kind text not null check (kind in ('note','call','email','meeting','form','task')),
  direction text check (direction is null or direction in ('in','out')),
  subject text,
  body text,
  occurred_at timestamptz not null default now(),
  external_ref text unique,              -- e.g. gmail:<message id>, so a message is logged once
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (contact_id is not null or company_id is not null or deal_id is not null)
);
create index if not exists office_activities_contact_idx on public.office_activities(contact_id, occurred_at desc);
create index if not exists office_activities_deal_idx on public.office_activities(deal_id, occurred_at desc);

-- Deal status follows its stage; business follows its pipeline -----------------------------
create or replace function public.office_deal_stage() returns trigger
language plpgsql set search_path = '' as $$
declare st jsonb; k text;
begin
  select p.stages, coalesce(new.business_id, p.business_id) into st, new.business_id from public.office_pipelines p where p.id = new.pipeline_id;
  select s->>'kind' into k from jsonb_array_elements(st) s where s->>'key' = new.stage;
  if k is null then raise exception 'Stage "%" is not in this pipeline.', new.stage; end if;
  new.status := k;
  if k in ('won','lost') and (tg_op = 'INSERT' or old.status = 'open') then new.closed_at := now(); end if;
  if k = 'open' then new.closed_at := null; end if;
  return new;
end $$;
drop trigger if exists office_deals_stage on public.office_deals;
create trigger office_deals_stage before insert or update of stage, pipeline_id on public.office_deals
  for each row execute function public.office_deal_stage();

-- Activity keeps "last contacted" and "last activity" current.
create or replace function public.office_activity_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.deal_id is not null then
    update public.office_deals set last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at) where id = new.deal_id;
  end if;
  if new.contact_id is not null and new.kind in ('email','call','meeting') then
    update public.office_contacts set last_contacted_at = greatest(coalesce(last_contacted_at, new.occurred_at), new.occurred_at) where id = new.contact_id;
  end if;
  return null;
end $$;
drop trigger if exists office_activities_touch on public.office_activities;
create trigger office_activities_touch after insert on public.office_activities
  for each row execute function public.office_activity_touch();

-- updated_at, RLS, grants -----------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['office_companies','office_contacts','office_pipelines','office_deals'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.office_touch_updated_at()', t || '_touch', t);
  end loop;
  foreach t in array array['office_companies','office_contacts','office_contact_businesses','office_pipelines','office_deals','office_activities'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.factory_is_admin())) with check ((select public.factory_is_admin()))', t || '_admin', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- A sales pipeline for the company and each venture -------------------------------------------------
insert into public.office_pipelines (business_id, name, stages, sort_order)
select b.id,
       case b.slug when 'ai-real-solutions' then 'Client projects' when 'cemeterybuilder' then 'Pilots & sales' else 'Sales' end,
       '[{"key":"lead","label":"Lead","kind":"open"},{"key":"discovery","label":"Discovery","kind":"open"},{"key":"proposal","label":"Proposal sent","kind":"open"},{"key":"negotiation","label":"Negotiating","kind":"open"},{"key":"won","label":"Won","kind":"won"},{"key":"lost","label":"Lost","kind":"lost"}]'::jsonb,
       b.sort_order
  from public.office_businesses b
 where b.relationship in ('parent','venture')
   and not exists (select 1 from public.office_pipelines p where p.business_id = b.id);
