-- Golf Buddy: put the whole golf site behind the group PIN.
-- Run after golfbuddy-admin.sql. Safe to re-run.
--
-- The existing read functions move into the private golfbuddy schema (the API role cannot reach
-- that schema), and public wrappers with an extra p_pin argument take their place. Once a group PIN
-- is set, a wrapper returns null unless p_pin is the group or admin PIN. With no group PIN set,
-- everything stays open. Wrong PINs count toward the existing 20-per-15-minutes lockout;
-- an empty PIN (a visitor who has not unlocked yet) is not counted.

-- 1) Move the current read functions out of the API (only once).
do $$
declare
  f text;
begin
  foreach f in array array[
    'golf_courses()', 'golf_round(uuid)', 'golf_recent_rounds(integer)',
    'golf_leaderboard(integer, text)', 'golf_team_record(integer)', 'golf_roster()'
  ] loop
    if to_regprocedure('public.' || f) is not null and to_regprocedure('golfbuddy.' || f) is null then
      execute format('alter function public.%s set schema golfbuddy', f);
    end if;
  end loop;
end $$;

revoke all on function golfbuddy.golf_courses(), golfbuddy.golf_round(uuid), golfbuddy.golf_recent_rounds(integer),
  golfbuddy.golf_leaderboard(integer, text), golfbuddy.golf_team_record(integer), golfbuddy.golf_roster()
  from public, anon, authenticated;

-- 2) Who may view.
create or replace function golfbuddy.can_view(p_pin text) returns boolean
language plpgsql volatile set search_path = '' as $$
begin
  if (select s.group_pin_hash is null from golfbuddy.settings s where s.id = 1) then return true; end if;
  if coalesce(p_pin, '') = '' then return false; end if;
  if golfbuddy.pin_locked() then return false; end if;
  return golfbuddy.pin_role(p_pin) is not null;
end;
$$;
revoke all on function golfbuddy.can_view(text) from public;

-- 3) Public wrappers (same names, plus p_pin).
create or replace function public.golf_courses(p_pin text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not golfbuddy.can_view(p_pin) then return null; end if;
  return golfbuddy.golf_courses();
end;
$$;

create or replace function public.golf_round(p_id uuid, p_pin text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not golfbuddy.can_view(p_pin) then return null; end if;
  return golfbuddy.golf_round(p_id);
end;
$$;

create or replace function public.golf_recent_rounds(p_limit integer default 10, p_pin text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not golfbuddy.can_view(p_pin) then return null; end if;
  return golfbuddy.golf_recent_rounds(p_limit);
end;
$$;

create or replace function public.golf_leaderboard(p_year integer default null, p_format text default 'wolf', p_pin text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not golfbuddy.can_view(p_pin) then return null; end if;
  return golfbuddy.golf_leaderboard(p_year, p_format);
end;
$$;

create or replace function public.golf_team_record(p_year integer default null, p_pin text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not golfbuddy.can_view(p_pin) then return null; end if;
  return golfbuddy.golf_team_record(p_year);
end;
$$;

create or replace function public.golf_roster(p_pin text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not golfbuddy.can_view(p_pin) then return null; end if;
  return golfbuddy.golf_roster();
end;
$$;

revoke all on function public.golf_courses(text), public.golf_round(uuid, text), public.golf_recent_rounds(integer, text),
  public.golf_leaderboard(integer, text, text), public.golf_team_record(integer, text), public.golf_roster(text) from public;
grant execute on function public.golf_courses(text), public.golf_round(uuid, text), public.golf_recent_rounds(integer, text),
  public.golf_leaderboard(integer, text, text), public.golf_team_record(integer, text), public.golf_roster(text)
  to anon, authenticated;
