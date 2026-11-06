-- Golf Buddy: GPS drives from regular rounds too.
-- Run after golfbuddy-shot-gps.sql. Safe to re-run. Replaces one read function; no table changes.
--
-- Regular Dots rounds can now record each player's own shots:
--   round_holes.extras.seatSpots = [[[lat, lng] | null, ...], ...]   (one list per seat)
-- Player stats count those drives alongside captain's choice drives.

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
  -- GPS: a drive is the first shot on a par 4 or 5 with spots for shots 1 and 2 (captain's choice: the team's ball).
  drives as (
    select pl.k, golfbuddy.yards(d.s1, d.s2) as yds
    from r
    join golfbuddy.round_holes h on h.round_id = r.id and r.scramble and h.par >= 4
    cross join lateral (values ('black'), ('white')) t(team)
    cross join lateral (select h.extras->'shots'->t.team->>0 as seat_txt,
                               h.extras->'shotSpots'->t.team->0 as s1,
                               h.extras->'shotSpots'->t.team->1 as s2) d
    join pl on pl.round_id = h.round_id and pl.team = t.team and pl.seat::text = d.seat_txt
    where jsonb_typeof(d.s1) = 'array' and jsonb_typeof(d.s2) = 'array'
    union all
    -- Regular Dots rounds: each player's own ball (extras.seatSpots, by seat).
    select pl.k, golfbuddy.yards(h.extras->'seatSpots'->(pl.seat::int)->0, h.extras->'seatSpots'->(pl.seat::int)->1)
    from pl
    join r on r.id = pl.round_id and r.format = 'points' and not r.scramble
    join golfbuddy.round_holes h on h.round_id = pl.round_id and h.par >= 4
    where jsonb_typeof(h.extras->'seatSpots'->(pl.seat::int)->0) = 'array'
      and jsonb_typeof(h.extras->'seatSpots'->(pl.seat::int)->1) = 'array'
  ),
  drive_stats as (
    select k, count(*) as n, round(avg(yds)) as avg_yds, max(yds) as max_yds
    from drives where yds between 30 and 450 group by k
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
    'drives', coalesce(ds.n, 0),
    'avgDrive', ds.avg_yds,
    'longestDrive', ds.max_yds,
    'handicap', (select pr.handicap from golfbuddy.players pr where lower(trim(pr.name)) = p.k limit 1)
  ) order by p.name), '[]'::jsonb)
  from people p
  left join indiv i on i.k = p.k
  left join best b on b.k = p.k
  left join shot_stats ss on ss.k = p.k
  left join drive_stats ds on ds.k = p.k;
$$;
revoke all on function golfbuddy.golf_player_stats(integer) from public, anon, authenticated;
