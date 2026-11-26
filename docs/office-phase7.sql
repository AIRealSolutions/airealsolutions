-- The Office, phase 7: posting straight to YouTube, Facebook and Instagram, results pulled back,
-- and reels assembled from templates. Run after docs/office-phase6.sql. Safe to run more than once.
-- All tables are admin-only. Access tokens are encrypted by the server (INTEGRATIONS_ENCRYPTION_KEY)
-- before they are stored, and the server never sends them to the browser.

-- Connected channels: a YouTube channel, a Facebook Page or an Instagram professional account -------
create table if not exists public.office_social_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.office_businesses(id) on delete set null,
  provider text not null check (provider in ('youtube','facebook','instagram')),
  external_id text not null,          -- channel id, Page id or Instagram user id
  name text not null,
  handle text,
  avatar_url text,
  token_ciphertext text not null,     -- encrypted; YouTube: refresh token, Meta: Page token
  status text not null default 'connected' check (status in ('connected','error')),
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);
create index if not exists office_social_accounts_business_idx on public.office_social_accounts(business_id);

-- One row per content piece per channel it goes out on ----------------------------------------------
create table if not exists public.office_publications (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.office_content(id) on delete cascade,
  account_id uuid references public.office_social_accounts(id) on delete set null,  -- null once disconnected
  provider text not null check (provider in ('youtube','facebook','instagram')),
  account_name text not null,
  status text not null default 'queued' check (status in ('queued','processing','published','failed','cancelled')),
  publish_at timestamptz not null default now(),   -- queued rows go out at or after this time
  privacy text not null default 'public' check (privacy in ('public','unlisted','private')),
  asset_ids uuid[] not null default '{}'::uuid[],  -- the media sent, in order
  container_id text,                  -- Instagram container or YouTube video id while it processes
  external_id text,                   -- the post, media or video id once published
  external_url text,
  error text,
  attempts int not null default 0,
  locked_until timestamptz,           -- a runner holds the row while it works on it
  metrics jsonb not null default '{}'::jsonb,
  metrics_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_id, account_id)
);
create index if not exists office_publications_due_idx on public.office_publications(status, publish_at);
create index if not exists office_publications_content_idx on public.office_publications(content_id);

-- The reel template and its settings, kept with the content piece ------------------------------------
alter table public.office_content add column if not exists reel jsonb not null default '{}'::jsonb;

do $$
declare t text;
begin
  foreach t in array array['office_social_accounts','office_publications'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.office_touch_updated_at()', t || '_touch', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.factory_is_admin())) with check ((select public.factory_is_admin()))', t || '_admin', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- When every channel a piece went out on is published, the piece is published too -------------------
create or replace function public.office_publication_rollup() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c uuid := coalesce(new.content_id, old.content_id);
  total int; done int; first_url text; first_at timestamptz;
begin
  select count(*) filter (where status <> 'cancelled'),
         count(*) filter (where status = 'published'),
         (array_agg(external_url order by published_at) filter (where status = 'published' and external_url is not null))[1],
         min(published_at) filter (where status = 'published')
    into total, done, first_url, first_at
    from public.office_publications where content_id = c;
  if total > 0 and total = done then
    update public.office_content
       set status = 'published', published_at = coalesce(published_at, first_at), published_url = coalesce(published_url, first_url)
     where id = c and status <> 'published';
  elsif tg_op = 'INSERT' and new.status = 'queued' then
    update public.office_content set status = 'scheduled', scheduled_at = coalesce(scheduled_at, new.publish_at)
     where id = c and status in ('idea','drafting','ready');
  end if;
  return null;
end $$;
revoke all on function public.office_publication_rollup() from public, anon, authenticated;

drop trigger if exists office_publications_rollup on public.office_publications;
create trigger office_publications_rollup after insert or update of status on public.office_publications
  for each row execute function public.office_publication_rollup();

-- Results: the piece's numbers are the sum across the channels it went out on ------------------------
create or replace function public.office_publication_metrics() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb;
begin
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into m from (
    select key as k, sum((value)::numeric)::bigint as v
      from public.office_publications p, jsonb_each_text(p.metrics)
     where p.content_id = new.content_id and value ~ '^[0-9]+(\.[0-9]+)?$'
     group by key) s;
  -- keep numbers typed in by hand (clicks, leads) that no channel reports
  update public.office_content set metrics = metrics || m where id = new.content_id;
  return null;
end $$;
revoke all on function public.office_publication_metrics() from public, anon, authenticated;

drop trigger if exists office_publications_metrics on public.office_publications;
create trigger office_publications_metrics after update of metrics on public.office_publications
  for each row when (new.metrics is distinct from old.metrics) execute function public.office_publication_metrics();
