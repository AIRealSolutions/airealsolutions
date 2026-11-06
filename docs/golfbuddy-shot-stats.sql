-- Golf Buddy: shot tracking stats and skill data for fair pairings.
-- Run after golfbuddy-pin-gate.sql. Safe to re-run. Adds read functions only (no table changes).
--
-- Captain's choice rounds can now record whose ball the team used on every shot:
--   round_holes.extras.shots = {"black": [seat, seat, ...], "white": [...]}
-- (one entry per team stroke, in order; null when nobody picked). golf_submit_round already
-- stores points-game extras as sent, so no change is needed there.
--
-- golf_player_stats returns, per player name (matched like the leaderboard, case-insensitive):
--   rounds, holes / overPar      individual scores (Wolf and regular Dots; captain's choice is a team score)
--   shotsUsed / shotsExpected    captain's choice shots the team used vs. a fair share (1 / team size per shot)
--   teeShots / holedShots        tee shots used and shots that went in
--   bestBalls                    regular Dots holes where the player had (or tied) the team's best score
--   handicap                     from the players list in the control panel, when set
-- The skill rating and team balancing are computed in the app (app/golf/lib/skill.ts).

create or replace function golfbuddy.golf_player_stats(p_year integer) returns jsonb
language sql stable set search_path = '' as $$
  with r as (
    select r.id, r.format,
           coalesce(r.settings->'rules'->>'scramble', '0') in ('1', 'true') as scramble
    from golfbuddy.rounds r
    where p_year is null or extract(year from r.played_on) = p_year
  ),
  pl as (
    select rp.round_id, rp.seat, rp.team, lower(trim(rp.name)) as k, rp.name
    from golfbuddy.round_players rp join r on r.id = rp.round_id
  ),
  team_size as (
    select round_id, team, count(*)::numeric as n from pl where team is not null group by round_id, team
  ),
  -- Individual scores (not captain's choice, where every player carries the team score).
  indiv as (
    select pl.k, count(*) as holes, sum((h.strokes->>pl.seat::int)::int - h.par) as over_par
    from pl
    join r on r.id = pl.round_id and not r.scramble
    join golfbuddy.round_holes h on h.round_id = pl.round_id
    where coalesce(h.strokes->>pl.seat::int, '') ~ '^\d{1,2}$'
    group by pl.k
  ),
  -- Regular Dots: who had (or tied) the team's best score on each hole.
  scored as (
    select pl.k, pl.round_id, pl.team, h.hole_number, (h.strokes->>pl.seat::int)::int as s
    from pl
    join r on r.id = pl.round_id and r.format = 'points' and not r.scramble
    join golfbuddy.round_holes h on h.round_id = pl.round_id
    where pl.team is not null and coalesce(h.strokes->>pl.seat::int, '') ~ '^\d{1,2}$'
  ),
  best as (
    select k, count(*) as best_balls from (
      select k, s, min(s) over (partition by round_id, team, hole_number) as m from scored
    ) x where s = m group by k
  ),
  -- Captain's choice shots: one row per recorded shot.
  shots as (
    select h.round_id, t.team, e.seat_txt::int as seat, e.ord,
           jsonb_array_length(h.extras->'shots'->t.team) as len
    from r
    join golfbuddy.round_holes h on h.round_id = r.id and r.scramble
    cross join lateral (values ('black'), ('white')) t(team)
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(h.extras->'shots'->t.team) = 'array' then h.extras->'shots'->t.team else '[]'::jsonb end
    ) with ordinality e(seat_txt, ord)
    where e.seat_txt ~ '^\d$'
      and exists (select 1 from pl where pl.round_id = h.round_id and pl.seat = e.seat_txt::int and pl.team = t.team)
  ),
  shot_stats as (
    select pl.k,
           count(*) filter (where s.seat = pl.seat) as used,
           sum(1 / ts.n) as expected,
           count(*) filter (where s.seat = pl.seat and s.ord = 1) as tee,
           count(*) filter (where s.seat = pl.seat and s.ord = s.len) as holed,
           count(*) as team_shots
    from pl
    join shots s on s.round_id = pl.round_id and s.team = pl.team
    join team_size ts on ts.round_id = pl.round_id and ts.team = pl.team
    group by pl.k
  ),
  people as (
    select k, min(name) as name, count(distinct round_id) as rounds from pl group by k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', p.name,
    'rounds', p.rounds,
    'holes', coalesce(i.holes, 0),
    'overPar', coalesce(i.over_par, 0),
    'bestBalls', coalesce(b.best_balls, 0),
    'shotsUsed', coalesce(ss.used, 0),
    'shotsExpected', round(coalesce(ss.expected, 0), 2),
    'teamShots', coalesce(ss.team_shots, 0),
    'teeShots', coalesce(ss.tee, 0),
    'holedShots', coalesce(ss.holed, 0),
    'handicap', (select pr.handicap from golfbuddy.players pr where lower(trim(pr.name)) = p.k limit 1)
  ) order by p.name), '[]'::jsonb)
  from people p
  left join indiv i on i.k = p.k
  left join best b on b.k = p.k
  left join shot_stats ss on ss.k = p.k;
$$;
revoke all on function golfbuddy.golf_player_stats(integer) from public, anon, authenticated;

-- Public wrapper behind the group PIN (same rule as the other read functions).
-- p_year null = all seasons (used for skill ratings).
create or replace function public.golf_player_stats(p_year integer default null, p_pin text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not golfbuddy.can_view(p_pin) then return null; end if;
  return golfbuddy.golf_player_stats(p_year);
end;
$$;
revoke all on function public.golf_player_stats(integer, text) from public;
grant execute on function public.golf_player_stats(integer, text) to anon, authenticated;
