-- Golf Buddy: full rounds for a season, for the news feed and the MVP race.
-- Run after golfbuddy-pin-gate.sql. Safe to re-run. Adds read functions only (no table changes).
--
-- golf_season_rounds(p_year, p_limit, p_pin) returns the same round objects as golf_round, newest
-- first, in one call (p_year null = any year; at most 500). Behind the group PIN like the other reads.

create or replace function golfbuddy.golf_season_rounds(p_year integer, p_limit integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(golfbuddy.golf_round(r.id) order by r.played_on desc, r.created_at desc), '[]'::jsonb)
  from (
    select id, played_on, created_at from golfbuddy.rounds
    where p_year is null or extract(year from played_on) = p_year
    order by played_on desc, created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 500)
  ) r;
$$;
revoke all on function golfbuddy.golf_season_rounds(integer, integer) from public, anon, authenticated;

create or replace function public.golf_season_rounds(p_year integer default null, p_limit integer default 50, p_pin text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not golfbuddy.can_view(p_pin) then return null; end if;
  return golfbuddy.golf_season_rounds(p_year, p_limit);
end;
$$;
revoke all on function public.golf_season_rounds(integer, integer, text) from public;
grant execute on function public.golf_season_rounds(integer, integer, text) to anon, authenticated;
