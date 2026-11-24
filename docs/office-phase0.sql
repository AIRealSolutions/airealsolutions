-- The Office, phase 0: accounting entities + the businesses the Office manages.
-- Applied to Supabase project xqdsmbyealtammgmpsqe as migration "office_phase0".
-- Only Factory admins (public.factory_admins, checked by public.factory_is_admin()) can read or change these rows.
--
-- Model: AI Real Solutions LLC is the one legal entity with its own books.
--   relationship = 'parent'  -> AI Real Solutions itself
--   relationship = 'venture' -> products owned by the LLC (tracked as business units in the LLC's books)
--   relationship = 'client'  -> outside businesses the LLC builds for and bills (e.g. Lightkeeper Realty).
--                              The Office tracks only their development goals; no real estate operations.

create table if not exists public.acct_entities (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null unique,
  short_name text not null,
  entity_type text not null default 'llc' check (entity_type in ('llc','corporation','sole_prop','partnership','nonprofit')),
  state text not null default 'NC',
  base_currency text not null default 'USD',
  fiscal_year_start_month smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.office_businesses (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.acct_entities(id) on delete restrict,
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  relationship text not null check (relationship in ('parent','venture','client')),
  category text,
  status text not null default 'active' check (status in ('focus','active','parked')),
  website text,
  summary text,
  weekly_focus text,
  brand jsonb not null default '{}'::jsonb,
  factory_project_id uuid references public.factory_projects(id) on delete set null,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists office_businesses_entity_idx on public.office_businesses(entity_id);

create or replace function public.office_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists acct_entities_touch on public.acct_entities;
create trigger acct_entities_touch before update on public.acct_entities
  for each row execute function public.office_touch_updated_at();
drop trigger if exists office_businesses_touch on public.office_businesses;
create trigger office_businesses_touch before update on public.office_businesses
  for each row execute function public.office_touch_updated_at();

alter table public.acct_entities enable row level security;
alter table public.office_businesses enable row level security;

drop policy if exists acct_entities_admin on public.acct_entities;
create policy acct_entities_admin on public.acct_entities for all to authenticated
  using ((select public.factory_is_admin())) with check ((select public.factory_is_admin()));
drop policy if exists office_businesses_admin on public.office_businesses;
create policy office_businesses_admin on public.office_businesses for all to authenticated
  using ((select public.factory_is_admin())) with check ((select public.factory_is_admin()));

revoke all on public.acct_entities, public.office_businesses from anon;
grant select, insert, update, delete on public.acct_entities, public.office_businesses to authenticated;

-- Seed ------------------------------------------------------------------------
insert into public.acct_entities (legal_name, short_name)
values ('AI Real Solutions LLC', 'AI Real Solutions')
on conflict (legal_name) do nothing;

with e as (select id from public.acct_entities where legal_name = 'AI Real Solutions LLC')
insert into public.office_businesses
  (entity_id, name, slug, relationship, category, status, website, summary, factory_project_id, sort_order)
select e.id, b.name, b.slug, b.relationship, b.category, b.status, b.website, b.summary,
       (select p.id from public.factory_projects p where p.slug = b.project_slug), b.sort_order
from e, (values
  ('AI Real Solutions',   'ai-real-solutions', 'parent',  'AI software & automation', 'focus',  'https://airealsolutions.com', 'The hub: the Software Factory, client builds and every venture.', 'factory', 10),
  ('CemeteryBuilder.ai',  'cemeterybuilder',   'venture', 'AI product',               'focus',  'https://cemeterybuilder.ai',  'AI agents that build cemetery layouts.', null, 20),
  ('NCIssues.com',        'ncissues',          'venture', 'Civic watchdog',           'active', 'https://ncissues.com',        'Tracks NC General Assembly bills for interested voters.', null, 30),
  ('VirtualClerk.ai',     'virtualclerk',      'venture', 'Government tech',          'active', 'https://virtualclerk.ai',     'AI clerk for local government offices.', 'clerk-775991', 40),
  ('ElectionAgents.com',  'electionagents',    'venture', 'Election tech',            'active', 'https://electionagents.com',  'AI tools for campaigns and election offices.', null, 50),
  ('SignForge',           'signforge',         'venture', 'Product',                  'active', null,                          'Internal venture in the Factory (prototype stage).', 'signforge', 60),
  ('Golf Buddy',          'golf-buddy',        'venture', 'Side app',                 'parked', 'https://airealsolutions.com/golf', 'Scorecards and games for the golf group.', 'golfbuddy', 70),
  ('Lightkeeper Realty',  'lightkeeper-realty','client',  'Real estate client',       'focus',  null,                          'Client of AI Real Solutions LLC. Office tracks development goals only.', null, 80),
  ('USAHUDHomes.com',     'usahudhomes',       'client',  'Real estate client',       'active', 'https://usahudhomes.com',     'Client site. Office tracks development goals only.', null, 90),
  ('FindANCHome.com',     'findanchome',       'client',  'Real estate client',       'active', 'https://findanchome.com',     'Client site for Southeastern NC. Office tracks development goals only.', null, 100)
) as b(name, slug, relationship, category, status, website, summary, project_slug, sort_order)
on conflict (slug) do nothing;
