-- The Office: the Incubator. Every product owned by AI Real Solutions LLC gets a business plan,
-- a marketing plan, a licensing & sale offer, and a sale-readiness checklist whose open items become tasks.
-- Run after docs/office-phase0..5.sql. Safe to run more than once. All tables are admin-only.

-- One row per product in the incubator ---------------------------------------------------------
create table if not exists public.office_ventures (
  business_id uuid primary key references public.office_businesses(id) on delete cascade,
  stage text not null default 'building' check (stage in ('idea','building','ready','for_sale','licensed','sold','paused')),
  sale_models text[] not null default '{}'::text[],   -- saas | white_label | source_license | exclusive_license | acquisition
  asking_price_cents bigint check (asking_price_cents is null or asking_price_cents >= 0),
  license_summary text,
  goal_id uuid references public.office_goals(id) on delete set null,   -- "Ready to sell <product>"
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sale_models <@ array['saas','white_label','source_license','exclusive_license','acquisition']::text[])
);

-- Plans and offers, versioned. content = {"sections":[{"key","title","body"}]} ------------------------
create table if not exists public.office_venture_docs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.office_businesses(id) on delete cascade,
  kind text not null check (kind in ('business_plan','marketing_plan','license_offer')),
  version integer not null,
  content jsonb not null default '{"sections":[]}'::jsonb,
  status text not null default 'draft' check (status in ('draft','approved')),
  source text not null default 'manual' check (source in ('ai','manual')),
  model text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, kind, version)
);

-- Sale-readiness checklist ------------------------------------------------------------------------
create table if not exists public.office_readiness_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.office_businesses(id) on delete cascade,
  category text not null check (category in ('product','legal','business','marketing','operations','financial')),
  title text not null check (length(trim(title)) > 0),
  detail text,
  template_key text,
  status text not null default 'todo' check (status in ('todo','doing','done','na')),
  task_id uuid references public.office_tasks(id) on delete set null,
  source text not null default 'template' check (source in ('template','ai','manual')),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, title)
);
create index if not exists office_readiness_business_idx on public.office_readiness_items(business_id, status);
create index if not exists office_readiness_task_idx on public.office_readiness_items(task_id);

-- updated_at, RLS, grants ------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['office_ventures','office_venture_docs','office_readiness_items'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.office_touch_updated_at()', t || '_touch', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.factory_is_admin())) with check ((select public.factory_is_admin()))', t || '_admin', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- The standard checklist every product needs before it can be licensed or sold ---------------------------
create or replace function public.office_seed_readiness(p_business uuid) returns integer
language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  insert into public.office_readiness_items (business_id, category, title, detail, template_key, sort_order)
  select p_business, t.category, t.title, t.detail, t.key, t.ord
  from (values
    ('product','product_mvp','MVP is feature-complete for the first buyers','The core workflows a paying customer needs work end to end.',10),
    ('product','product_qa','QA pass and known bugs fixed','Test the main flows; fix or document every known issue.',11),
    ('product','product_security','Security and privacy review','Row-level security, secrets server-side, data handling and backups checked.',12),
    ('product','product_docs','User guide and admin documentation','How to set up, use and administer the product.',13),
    ('product','product_demo','Live demo with sample data','A safe demo environment a buyer can try.',14),
    ('product','product_deploy','Repeatable deployment for each customer','Graduate from the Factory: own repo, database and hosting per licensee, or a multi-tenant plan.',15),
    ('legal','legal_ip','AI Real Solutions LLC owns all code and content','Contractor and collaborator IP assignments signed; nothing owned by someone else.',20),
    ('legal','legal_name','Name, trademark and domain checked','Search for conflicts; secure the domain; decide whether to file a trademark.',21),
    ('legal','legal_terms','Terms of service and privacy policy','Published on the product site.',22),
    ('legal','legal_license','License agreement template reviewed by an attorney','Covers scope, term, fees, support, warranties, liability and termination.',23),
    ('legal','legal_oss','Open-source license audit of dependencies','Confirm every library''s license allows commercial licensing or sale.',24),
    ('business','business_plan','Business plan approved','Written and approved in the Incubator.',30),
    ('business','pricing','Pricing and license models set','SaaS, white-label, source license or outright sale, with prices.',31),
    ('business','support','Support and maintenance plan','What licensees get, response times, updates.',32),
    ('business','books','Revenue and costs tracked for this business line','Invoices, expenses and bank transactions tagged to it in Accounting.',33),
    ('marketing','marketing_plan','Marketing plan approved','Written and approved in the Incubator.',40),
    ('marketing','website','Product website or landing page','Explains the product, pricing and how to buy or license it.',41),
    ('marketing','brand','Brand kit (logo, colors, voice)','',42),
    ('marketing','sales_kit','Sales deck and one-page overview','',43),
    ('marketing','demo_video','Demo video','A 2-3 minute walkthrough.',44),
    ('marketing','reference','First pilot customer or case study','Proof that it works for a real customer.',45),
    ('operations','billing','Billing set up','Products and prices in Invoicing & Billing; Stripe ready.',50),
    ('operations','onboarding','Onboarding checklist for new licensees','Steps from signed license to live product.',51),
    ('operations','cost_to_serve','Hosting and AI cost per customer known','',52),
    ('financial','unit_economics','Unit economics worked out','Price, cost to serve, margin, payback.',60),
    ('financial','valuation','Asking price and valuation basis','How the license fees or sale price were set.',61)
  ) as t(category, key, title, detail, ord)
  on conflict (business_id, title) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Finishing (or reopening) a linked task updates its checklist item ----------------------------------------
create or replace function public.office_readiness_from_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    update public.office_readiness_items
       set status = case when new.status = 'done' then 'done' when new.status = 'todo' and status = 'done' then 'doing' else status end
     where task_id = new.id and status <> 'na';
  end if;
  return null;
end $$;
drop trigger if exists office_tasks_readiness on public.office_tasks;
create trigger office_tasks_readiness after update of status on public.office_tasks
  for each row execute function public.office_readiness_from_task();

-- The "Ready to sell" goal counts done items out of everything that applies ----------------------------------
create or replace function public.office_readiness_goal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b uuid := coalesce(new.business_id, old.business_id); g uuid; total int; done int;
begin
  select goal_id into g from public.office_ventures where business_id = b;
  if g is null then return null; end if;
  select count(*) filter (where status <> 'na'), count(*) filter (where status = 'done') into total, done
    from public.office_readiness_items where business_id = b;
  update public.office_goals set target_value = total, current_value = done, unit = 'items',
         status = case when total > 0 and done >= total then 'done' when status = 'done' then 'open' else status end
   where id = g;
  return null;
end $$;
drop trigger if exists office_readiness_goal_sync on public.office_readiness_items;
create trigger office_readiness_goal_sync after insert or update or delete on public.office_readiness_items
  for each row execute function public.office_readiness_goal();

revoke all on function public.office_readiness_from_task(), public.office_readiness_goal() from public, anon, authenticated;
revoke all on function public.office_seed_readiness(uuid) from public, anon;
grant execute on function public.office_seed_readiness(uuid) to authenticated, service_role;

-- Put every product owned by the LLC into the incubator, with its checklist ---------------------------------
insert into public.office_ventures (business_id, stage)
select b.id, case when b.status = 'parked' then 'paused' when b.factory_project_id is null then 'idea' else 'building' end
  from public.office_businesses b
 where b.relationship in ('parent','venture')
on conflict (business_id) do nothing;

do $$
declare r record;
begin
  for r in select business_id from public.office_ventures loop
    perform public.office_seed_readiness(r.business_id);
  end loop;
end $$;
