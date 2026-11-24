-- The Office, phase 2: business feeds, weekly time blocks and the weekly review.
-- Run after docs/office-phase1.sql. Safe to run more than once. All tables are admin-only.

-- Feed sources: where each business's outside news comes from --------------------
create table if not exists public.office_feed_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.office_businesses(id) on delete cascade,
  kind text not null check (kind in ('rss','google_news')),
  name text not null check (length(trim(name)) > 0),
  config jsonb not null default '{}'::jsonb,          -- rss: {"url": "..."}; google_news: {"query": "..."}
  active boolean not null default true,
  last_fetched_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists office_feed_sources_business_idx on public.office_feed_sources(business_id);

-- Feed items: outside news plus internal events --------------------------------------
create table if not exists public.office_feed_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.office_businesses(id) on delete cascade,
  source_id uuid references public.office_feed_sources(id) on delete set null,
  kind text not null default 'news' check (kind in ('news','internal')),
  title text not null,
  url text,
  source_name text,
  summary text,
  published_at timestamptz,
  score integer check (score is null or score between 0 and 100),   -- set by the Feed Agent
  suggested_action jsonb,                                            -- {"type":"task|reminder|note","title":"..."}
  status text not null default 'new' check (status in ('new','saved','actioned','dismissed')),
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists office_feed_items_list_idx on public.office_feed_items(status, created_at desc);
create index if not exists office_feed_items_business_idx on public.office_feed_items(business_id, created_at desc);

-- Weekly time blocks: e.g. Tue/Thu 9-12 CemeteryBuilder --------------------------------
create table if not exists public.office_time_blocks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.office_businesses(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),          -- ISO: 1 Monday ... 7 Sunday
  start_time time not null,
  end_time time not null,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists office_time_blocks_day_idx on public.office_time_blocks(weekday, start_time);

-- Weekly reviews: one per week (week_start = Monday) ------------------------------------
create table if not exists public.office_weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique check (extract(isodow from week_start) = 1),
  summary text,
  wins jsonb not null default '[]'::jsonb,
  misses jsonb not null default '[]'::jsonb,
  proposals jsonb not null default '[]'::jsonb,   -- [{business_slug, weekly_focus, goals:[title]}]
  status text not null default 'draft' check (status in ('draft','accepted')),
  source text not null default 'ai' check (source in ('ai','quick')),
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['office_feed_sources','office_feed_items','office_time_blocks','office_weekly_reviews'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.office_touch_updated_at()', t || '_touch', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.factory_is_admin())) with check ((select public.factory_is_admin()))', t || '_admin', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Internal events into the feed -------------------------------------------------------
-- A goal reached, and a Factory project changing stage (for businesses linked to it).
-- SECURITY DEFINER so the event is written even when the person causing it cannot read the Office.
create or replace function public.office_feed_goal_done() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    insert into public.office_feed_items (business_id, kind, title, source_name, published_at, status, dedupe_key)
    values (new.business_id, 'internal', 'Goal reached: ' || new.title, 'Goals', now(), 'new', 'goal-done:' || new.id || ':' || extract(epoch from now())::bigint)
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists office_goals_feed on public.office_goals;
create trigger office_goals_feed after update of status on public.office_goals
  for each row execute function public.office_feed_goal_done();

create or replace function public.office_feed_project_stage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.stage is distinct from old.stage then
    insert into public.office_feed_items (business_id, kind, title, source_name, published_at, status, dedupe_key)
    select b.id, 'internal', new.name || ' moved to ' || replace(new.stage::text, '_', ' ') || ' in the Factory', 'Factory', now(), 'new',
           'stage:' || new.id || ':' || new.stage::text || ':' || extract(epoch from now())::bigint
      from public.office_businesses b where b.factory_project_id = new.id
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists factory_projects_office_feed on public.factory_projects;
create trigger factory_projects_office_feed after update of stage on public.factory_projects
  for each row execute function public.office_feed_project_stage();

revoke all on function public.office_feed_goal_done(), public.office_feed_project_stage() from public, anon, authenticated;

-- Starter news searches for the ventures (edit or delete them on the Feed page) ---------
insert into public.office_feed_sources (business_id, kind, name, config)
select b.id, 'google_news', s.name, jsonb_build_object('query', s.query)
from (values
  ('ai-real-solutions', 'AI for small business', '"AI automation" small business'),
  ('cemeterybuilder',   'Cemetery mapping & software', 'cemetery mapping OR "cemetery software" OR "cemetery records"'),
  ('ncissues',          'NC General Assembly', '"North Carolina General Assembly" OR "NC legislature"'),
  ('virtualclerk',      'AI in local government', '"local government" AI clerk OR "county clerk" AI'),
  ('electionagents',    'NC elections', '"North Carolina" "board of elections"')
) as s(slug, name, query)
join public.office_businesses b on b.slug = s.slug
where not exists (select 1 from public.office_feed_sources f where f.business_id = b.id and f.name = s.name);
