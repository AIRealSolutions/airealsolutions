-- The Office, phase 1: goals, tasks, reminders, notes and daily plans.
-- Run after docs/office-phase0.sql. Safe to run more than once.
-- Every table is admin-only (public.factory_is_admin()). Dates are America/New_York.

-- Goals: one tree per business, year -> quarter -> month -> week -> day ---------
create table if not exists public.office_goals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.office_businesses(id) on delete cascade,
  parent_id uuid references public.office_goals(id) on delete set null,
  level text not null check (level in ('year','quarter','month','week','day')),
  title text not null check (length(trim(title)) > 0),
  notes text,
  target_value numeric,
  current_value numeric not null default 0,
  unit text,
  due_on date,
  status text not null default 'open' check (status in ('open','done','dropped')),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists office_goals_business_idx on public.office_goals(business_id, status);
create index if not exists office_goals_parent_idx on public.office_goals(parent_id);

-- Tasks ------------------------------------------------------------------------
create table if not exists public.office_tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.office_businesses(id) on delete set null,
  goal_id uuid references public.office_goals(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  notes text,
  due_on date,
  estimate_min integer check (estimate_min is null or estimate_min between 1 and 1440),
  priority smallint not null default 2 check (priority between 1 and 3),   -- 1 high, 2 normal, 3 low
  status text not null default 'todo' check (status in ('todo','done','dropped')),
  source text not null default 'manual' check (source in ('manual','capture','ai','note')),
  recurrence text not null default 'none' check (recurrence in ('none','daily','weekdays','weekly','monthly')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists office_tasks_open_idx on public.office_tasks(status, due_on);
create index if not exists office_tasks_business_idx on public.office_tasks(business_id);
create index if not exists office_tasks_goal_idx on public.office_tasks(goal_id);

-- Reminders --------------------------------------------------------------------
create table if not exists public.office_reminders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.office_businesses(id) on delete set null,
  task_id uuid references public.office_tasks(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  notes text,
  remind_at timestamptz not null,
  recurrence text not null default 'none' check (recurrence in ('none','daily','weekdays','weekly','monthly')),
  status text not null default 'pending' check (status in ('pending','done','dismissed')),
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists office_reminders_due_idx on public.office_reminders(status, remind_at);

-- Notebook ---------------------------------------------------------------------
create table if not exists public.office_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.office_businesses(id) on delete set null,
  title text not null default '',
  body text not null default '',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists office_notes_business_idx on public.office_notes(business_id, updated_at desc);

-- Daily plans: one per day ------------------------------------------------------
create table if not exists public.office_daily_plans (
  id uuid primary key default gen_random_uuid(),
  plan_date date not null unique,
  brief text,
  big_goals jsonb not null default '[]'::jsonb,
  agenda jsonb not null default '[]'::jsonb,
  reflection text,
  source text not null default 'ai' check (source in ('ai','quick')),
  model text,
  usage jsonb,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at, RLS, grants ------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['office_goals','office_tasks','office_reminders','office_notes','office_daily_plans'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.office_touch_updated_at()', t || '_touch', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.factory_is_admin())) with check ((select public.factory_is_admin()))', t || '_admin', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Recurrence helpers -------------------------------------------------------------
create or replace function public.office_next_date(d date, rec text) returns date
language sql immutable set search_path = '' as $$
  select case rec
    when 'daily'    then d + 1
    when 'weekdays' then d + case extract(isodow from d)::int when 5 then 3 when 6 then 2 else 1 end
    when 'weekly'   then d + 7
    when 'monthly'  then (d + interval '1 month')::date
    else null end;
$$;

-- Complete a task; a recurring task gets its next copy. Returns the new task's id (or null).
-- SECURITY INVOKER: row-level security still applies to the caller.
create or replace function public.office_complete_task(p_task uuid) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare t public.office_tasks; next_id uuid; today date := (now() at time zone 'America/New_York')::date;
begin
  update public.office_tasks set status = 'done', completed_at = now()
   where id = p_task and status = 'todo' returning * into t;
  if not found then return null; end if;
  if t.recurrence <> 'none' then
    insert into public.office_tasks (business_id, goal_id, title, notes, due_on, estimate_min, priority, source, recurrence)
    values (t.business_id, t.goal_id, t.title, t.notes,
            public.office_next_date(greatest(coalesce(t.due_on, today), today), t.recurrence),
            t.estimate_min, t.priority, t.source, t.recurrence)
    returning id into next_id;
  end if;
  return next_id;
end $$;

-- Mark a reminder done; a recurring reminder moves to its next time instead.
create or replace function public.office_complete_reminder(p_reminder uuid) returns timestamptz
language plpgsql security invoker set search_path = '' as $$
declare r public.office_reminders; nxt timestamptz;
begin
  select * into r from public.office_reminders where id = p_reminder and status = 'pending';
  if not found then return null; end if;
  if r.recurrence = 'none' then
    update public.office_reminders set status = 'done' where id = r.id;
    return null;
  end if;
  nxt := r.remind_at;
  loop
    nxt := case r.recurrence
      when 'daily' then nxt + interval '1 day'
      when 'weekly' then nxt + interval '7 days'
      when 'monthly' then nxt + interval '1 month'
      else nxt + interval '1 day' end;
    if r.recurrence = 'weekdays' then
      while extract(isodow from (nxt at time zone 'America/New_York')) in (6, 7) loop
        nxt := nxt + interval '1 day';
      end loop;
    end if;
    exit when nxt > now();
  end loop;
  update public.office_reminders set remind_at = nxt, last_sent_at = null where id = r.id;
  return nxt;
end $$;

revoke all on function public.office_complete_task(uuid), public.office_complete_reminder(uuid) from public, anon;
grant execute on function public.office_complete_task(uuid), public.office_complete_reminder(uuid) to authenticated, service_role;
