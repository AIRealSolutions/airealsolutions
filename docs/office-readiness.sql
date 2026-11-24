-- The Office: production readiness for every business, AI plan reviews and the advisor conversation.
-- Run after docs/office-incubator.sql. Safe to run more than once. All tables are admin-only.
--
--  * Readiness now has two tracks: 'production' (live, reliable, supported) for every business,
--    and 'sale' (can be licensed or sold) for products the LLC owns.
--  * Clients join the Incubator (production track, business/marketing/launch plans).
--  * New document kind: launch_plan. AI reviews are stored per document version.

-- Two tracks on the checklist ----------------------------------------------------------------------
alter table public.office_readiness_items add column if not exists track text not null default 'sale';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'office_readiness_items_track_check') then
    alter table public.office_readiness_items add constraint office_readiness_items_track_check check (track in ('production','sale'));
  end if;
  if exists (select 1 from pg_constraint where conname = 'office_readiness_items_business_id_title_key') then
    alter table public.office_readiness_items drop constraint office_readiness_items_business_id_title_key;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'office_readiness_items_track_title_key') then
    alter table public.office_readiness_items add constraint office_readiness_items_track_title_key unique (business_id, track, title);
  end if;
end $$;

-- Production goal and a "live" stage -----------------------------------------------------------------
alter table public.office_ventures add column if not exists production_goal_id uuid references public.office_goals(id) on delete set null;
alter table public.office_ventures drop constraint if exists office_ventures_stage_check;
alter table public.office_ventures add constraint office_ventures_stage_check
  check (stage in ('idea','building','ready','live','for_sale','licensed','sold','paused'));

-- Launch plan documents --------------------------------------------------------------------------------
alter table public.office_venture_docs drop constraint if exists office_venture_docs_kind_check;
alter table public.office_venture_docs add constraint office_venture_docs_kind_check
  check (kind in ('business_plan','marketing_plan','launch_plan','license_offer'));

-- AI reviews of a document version -------------------------------------------------------------------------
create table if not exists public.office_venture_reviews (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.office_venture_docs(id) on delete cascade,
  business_id uuid not null references public.office_businesses(id) on delete cascade,
  review jsonb not null,     -- {score, verdict, strengths[], weaknesses[], sections[{key,score,critique,suggestion}], missing[], questions[], readiness[{track,category,title,detail}]}
  model text,
  created_at timestamptz not null default now()
);
create index if not exists office_venture_reviews_doc_idx on public.office_venture_reviews(doc_id, created_at desc);

-- The advisor conversation for each business ------------------------------------------------------------------
create table if not exists public.office_venture_chats (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.office_businesses(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  actions jsonb not null default '[]'::jsonb,   -- advisor's suggested tasks / checklist items
  created_at timestamptz not null default now()
);
alter table public.office_venture_chats add column if not exists actions jsonb not null default '[]'::jsonb;
create index if not exists office_venture_chats_business_idx on public.office_venture_chats(business_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['office_venture_reviews','office_venture_chats'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.factory_is_admin())) with check ((select public.factory_is_admin()))', t || '_admin', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- The standard production checklist ------------------------------------------------------------------------------
create or replace function public.office_seed_production(p_business uuid) returns integer
language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  insert into public.office_readiness_items (business_id, track, category, title, detail, template_key, sort_order)
  select p_business, 'production', t.category, t.title, t.detail, t.key, t.ord
  from (values
    ('product','p_scope','Launch scope agreed and signed off','What is in version 1 and what waits; the owner (or client) has signed off.',10),
    ('product','p_features','Launch features complete','Every in-scope workflow works end to end on production data.',11),
    ('product','p_qa','Tested on phone and desktop','Main flows tested on real devices and browsers; known bugs fixed or accepted.',12),
    ('product','p_access','Accessibility basics','Readable contrast, keyboard use, labels, alt text.',13),
    ('product','p_perf','Fast enough','Pages load quickly on a phone connection; heavy pages checked.',14),
    ('operations','p_domain','Domain and DNS live with HTTPS','The real domain points to production (GoDaddy DNS to Vercel) with a valid certificate.',20),
    ('operations','p_hosting','Production hosting and deploys','Production project on Vercel; deploys from the main branch; preview deploys for changes.',21),
    ('operations','p_database','Production database with backups','Supabase project with row-level security on every table and backups confirmed.',22),
    ('operations','p_secrets','Secrets and keys set in production only','API keys in Vercel environment variables, never in code or the browser.',23),
    ('operations','p_monitoring','Error monitoring and uptime checks','Runtime errors and downtime are noticed within minutes.',24),
    ('operations','p_email','Email sending works','Sign-in, notification and contact emails deliver (domain verified, not landing in spam).',25),
    ('operations','p_support','Support process','How users report problems and who answers, with response times.',26),
    ('legal','p_privacy','Privacy policy and terms published','Linked in the footer; match what the product actually does with data.',30),
    ('legal','p_data','Data protection checked','Personal data identified, access limited by role, nothing sensitive exposed publicly.',31),
    ('marketing','p_content','Content complete and proofread','No placeholder text or images; contact details correct.',40),
    ('marketing','p_seo','SEO and sharing basics','Titles, descriptions, sitemap, social preview images, Google Search Console.',41),
    ('marketing','p_analytics','Analytics in place','Visits and key actions measured (e.g. Vercel Analytics).',42),
    ('business','p_training','Owner or client trained','The people running it know how to use and administer it.',50),
    ('business','p_signoff','Go-live sign-off and rollback plan','A date, a checklist for launch day, and how to undo it if something breaks.',51)
  ) as t(category, key, title, detail, ord)
  on conflict (business_id, track, title) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.office_seed_production(uuid) from public, anon;
grant execute on function public.office_seed_production(uuid) to authenticated, service_role;

-- The standard sale checklist keeps working (now on the 'sale' track) ---------------------------------------------
create or replace function public.office_seed_readiness(p_business uuid) returns integer
language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  insert into public.office_readiness_items (business_id, track, category, title, detail, template_key, sort_order)
  select p_business, 'sale', t.category, t.title, t.detail, t.key, t.ord
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
  on conflict (business_id, track, title) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Goals follow their track -------------------------------------------------------------------------------------------
create or replace function public.office_readiness_goal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare b uuid := coalesce(new.business_id, old.business_id); tr text := coalesce(new.track, old.track); g uuid; total int; done int;
begin
  select case when tr = 'production' then production_goal_id else goal_id end into g from public.office_ventures where business_id = b;
  if g is null then return null; end if;
  select count(*) filter (where status <> 'na'), count(*) filter (where status = 'done') into total, done
    from public.office_readiness_items where business_id = b and track = tr;
  update public.office_goals set target_value = total, current_value = done, unit = 'items',
         status = case when total > 0 and done >= total then 'done' when status = 'done' then 'open' else status end
   where id = g;
  return null;
end $$;
revoke all on function public.office_readiness_goal() from public, anon, authenticated;

-- Enroll clients too, and give every business the production checklist ----------------------------------------------
insert into public.office_ventures (business_id, stage)
select b.id, case when b.status = 'parked' then 'paused' else 'building' end
  from public.office_businesses b
 where b.relationship = 'client'
on conflict (business_id) do nothing;

do $$
declare r record;
begin
  for r in select business_id from public.office_ventures loop
    perform public.office_seed_production(r.business_id);
  end loop;
end $$;

-- Clients are sold by their owners, not licensed by the LLC: drop untouched sale items for them.
delete from public.office_readiness_items i
 using public.office_businesses b
 where b.id = i.business_id and b.relationship = 'client' and i.track = 'sale'
   and i.source = 'template' and i.status = 'todo' and i.task_id is null;
