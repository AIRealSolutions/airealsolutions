-- The Office, phase 6: Content Studio (brand kits, content calendar and pipeline) and the media Library.
-- Run after docs/office-readiness.sql. Safe to run more than once. All tables are admin-only.

-- Brand kit: one per business ---------------------------------------------------------------------
create table if not exists public.office_brand_kits (
  business_id uuid primary key references public.office_businesses(id) on delete cascade,
  tagline text,
  voice text,                    -- how it sounds: tone, words to use and avoid
  audience text,                 -- who it talks to
  colors text[] not null default '{}'::text[],   -- hex colors, e.g. {#1D4ED8,#0F766E}
  fonts text,
  hashtags text[] not null default '{}'::text[],
  disclaimers text,              -- required lines (e.g. Equal Housing for real estate clients)
  do_dont text,
  logo_asset_id uuid,
  updated_at timestamptz not null default now(),
  check (array_to_string(colors, ',') ~* '^(#[0-9a-f]{6}(,#[0-9a-f]{6})*)?$')
);

-- Library: files in the private "office-library" bucket --------------------------------------------
create table if not exists public.office_assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.office_businesses(id) on delete set null,
  storage_path text not null unique,
  file_name text not null,
  mime text,
  size_bytes bigint,
  kind text not null default 'other' check (kind in ('image','video','audio','document','logo','other')),
  tags text[] not null default '{}'::text[],
  campaign text,
  caption text,
  created_at timestamptz not null default now()
);
create index if not exists office_assets_business_idx on public.office_assets(business_id, created_at desc);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'office_brand_kits_logo_fk') then
    alter table public.office_brand_kits add constraint office_brand_kits_logo_fk foreign key (logo_asset_id) references public.office_assets(id) on delete set null;
  end if;
end $$;

-- Content: ideas through published pieces -------------------------------------------------------------
create table if not exists public.office_content (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.office_businesses(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  format text not null default 'post' check (format in ('reel','short','youtube','post','carousel','blog','email','newsletter')),
  channels text[] not null default '{}'::text[],
  status text not null default 'idea' check (status in ('idea','drafting','ready','scheduled','published','archived')),
  idea text,                     -- the angle / brief
  draft jsonb not null default '{}'::jsonb,   -- {hook, script, beats[], shot_list[], caption, hashtags[], cta, title_options[], description, chapters[], thumbnail}
  notes text,
  asset_ids uuid[] not null default '{}'::uuid[],
  scheduled_at timestamptz,
  published_at timestamptz,
  published_url text,
  metrics jsonb not null default '{}'::jsonb, -- {views, likes, comments, shares, clicks, leads}
  source text not null default 'manual' check (source in ('manual','ai','feed','plan')),
  feed_item_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (channels <@ array['facebook','instagram','youtube','tiktok','linkedin','x','website','email']::text[])
);
create index if not exists office_content_calendar_idx on public.office_content(scheduled_at);
create index if not exists office_content_business_idx on public.office_content(business_id, status);

do $$
declare t text;
begin
  foreach t in array array['office_brand_kits','office_content'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.office_touch_updated_at()', t || '_touch', t);
  end loop;
  foreach t in array array['office_brand_kits','office_assets','office_content'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.factory_is_admin())) with check ((select public.factory_is_admin()))', t || '_admin', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Private storage for the Library (Supabase Storage), admin-only ------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('office-library', 'office-library', false, 52428800)   -- 50 MB per file
    on conflict (id) do nothing;
    drop policy if exists office_library_admin on storage.objects;
    create policy office_library_admin on storage.objects for all to authenticated
      using (bucket_id = 'office-library' and (select public.factory_is_admin()))
      with check (bucket_id = 'office-library' and (select public.factory_is_admin()));
  end if;
end $$;

-- A starting brand kit for every business (fill in the details in the Studio) -------------------------------
insert into public.office_brand_kits (business_id, tagline, disclaimers)
select b.id, null,
       case when b.relationship = 'client' and b.category ilike '%real estate%' then 'Equal Housing Opportunity. Include the brokerage name and license details required by the NC Real Estate Commission.' end
  from public.office_businesses b
on conflict (business_id) do nothing;
