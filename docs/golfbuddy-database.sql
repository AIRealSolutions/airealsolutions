-- Golf Buddy (airealsolutions.com/golf): Wolf and Team Points (Black Belt vs White Belt)
-- Lives in the existing `golfbuddy` schema of the shared AI Real Solutions Supabase project.
-- Rounds are submitted by anyone (no login). The browser only uses the publishable key and
-- talks to SECURITY DEFINER functions in `public`; the golfbuddy tables themselves have RLS
-- on with no policies, so nothing in the schema is reachable directly.

-- 1) Lock down legacy tables: contact info in players must never be public.
drop policy if exists "Allow public read" on golfbuddy.players;
drop policy if exists "Allow public read" on golfbuddy.matches;
drop policy if exists "Allow public read" on golfbuddy.games;
drop policy if exists "Allow public read" on golfbuddy.scores;

-- 2) Round tables (free-text player names, per-hole comments).
create table if not exists golfbuddy.rounds(
  id uuid primary key default gen_random_uuid(),
  course_id integer not null references golfbuddy.courses(id),
  played_on date not null default current_date,
  format text not null default 'wolf' check (format in ('wolf', 'points')),
  team_points jsonb,                -- points game: {"black": n, "white": n}
  settings jsonb not null default '{}'::jsonb,
  submitted_by text check (char_length(submitted_by) <= 60),
  created_at timestamptz not null default now()
);
create table if not exists golfbuddy.round_players(
  round_id uuid not null references golfbuddy.rounds(id) on delete cascade,
  seat smallint not null check (seat between 0 and 7),
  team text check (team in ('black', 'white')),             -- points game
  result text check (result in ('win', 'loss', 'tie')),     -- points game
  name text not null check (char_length(name) between 1 and 40),
  total_points integer not null default 0,
  total_strokes integer not null default 0,
  primary key (round_id, seat)
);
create table if not exists golfbuddy.round_holes(
  round_id uuid not null references golfbuddy.rounds(id) on delete cascade,
  hole_number smallint not null check (hole_number between 1 and 18),
  par smallint not null,
  wolf_seat smallint,               -- wolf game
  partner_seat smallint,
  lone_wolf boolean not null default false,
  strokes jsonb not null,           -- ["4","5",...] by seat
  points jsonb not null,            -- [2,0,...] by seat (points game: personal bonus points)
  extras jsonb not null default '{}'::jsonb, -- points game: sandSaves, closest, teamPoints, bestBall
  comment text check (char_length(comment) <= 500),
  primary key (round_id, hole_number)
);
create index if not exists rounds_played_idx on golfbuddy.rounds(played_on desc, created_at desc);
alter table golfbuddy.rounds enable row level security;
alter table golfbuddy.round_players enable row level security;
alter table golfbuddy.round_holes enable row level security;

-- 3) Public API (callable with the publishable key).
create or replace function public.golf_courses() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'city', c.city, 'state', c.state, 'par', c.par,
    'holes', (select coalesce(jsonb_agg(jsonb_build_object(
        'number', h.hole_number, 'par', h.par, 'handicap', h.handicap,
        'yardsWhite', h.yards_white, 'yardsBlue', h.yards_blue, 'yardsBlack', h.yards_black
      ) order by h.hole_number), '[]'::jsonb) from golfbuddy.holes h where h.course_id = c.id)
  ) order by c.name), '[]'::jsonb) from golfbuddy.courses c;
$$;


create or replace function public.golf_submit_round(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  rid uuid;
  fmt text := coalesce(p->>'format', 'wolf');
  n int := jsonb_array_length(coalesce(p->'players', '[]'::jsonb));
  h jsonb;
  i int;
  pts int[];
  strk int[];
  v int;
  tb int := 0;
  tw int := 0;
  team text;
begin
  if fmt not in ('wolf', 'points') then raise exception 'Unknown game'; end if;
  if fmt = 'wolf' and (n < 3 or n > 5) then raise exception 'Wolf needs 3 to 5 players'; end if;
  if fmt = 'points' then
    if n < 2 or n > 8 then raise exception 'Team Points needs 2 to 8 players'; end if;
    if jsonb_array_length(coalesce(p->'teams', '[]'::jsonb)) <> n then raise exception 'Every player needs a team'; end if;
    if exists (select 1 from jsonb_array_elements_text(p->'teams') t where t not in ('black', 'white')) then
      raise exception 'Teams must be black or white';
    end if;
    if not (p->'teams' @> '["black"]'::jsonb and p->'teams' @> '["white"]'::jsonb) then
      raise exception 'Each team needs at least one player';
    end if;
  end if;
  if jsonb_array_length(coalesce(p->'holes', '[]'::jsonb)) not between 1 and 18 then
    raise exception 'A round needs 1 to 18 holes';
  end if;
  if not exists (select 1 from golfbuddy.courses where id = (p->>'courseId')::int) then
    raise exception 'Unknown course';
  end if;

  insert into golfbuddy.rounds(course_id, played_on, format, settings, submitted_by)
  values ((p->>'courseId')::int,
          coalesce((p->>'playedOn')::date, current_date),
          fmt,
          coalesce(p->'settings', '{}'::jsonb),
          nullif(left(trim(p->>'submittedBy'), 60), ''))
  returning id into rid;

  pts := array_fill(0, array[n]);
  strk := array_fill(0, array[n]);
  for h in select * from jsonb_array_elements(p->'holes') loop
    if jsonb_array_length(h->'strokes') <> n or jsonb_array_length(h->'points') <> n then
      raise exception 'Hole % has the wrong number of scores', h->>'number';
    end if;
    for i in 0..n-1 loop
      v := (h->'strokes'->>i)::int;
      if v < 1 or v > 15 then raise exception 'Hole % has an invalid score', h->>'number'; end if;
      strk[i+1] := strk[i+1] + v;
      v := (h->'points'->>i)::int;
      if v < 0 or v > 20 then raise exception 'Hole % has invalid points', h->>'number'; end if;
      pts[i+1] := pts[i+1] + v;
    end loop;
    if fmt = 'points' then
      v := coalesce((h->'extras'->'teamPoints'->>'black')::int, 0);
      if v < 0 or v > 40 then raise exception 'Hole % has invalid team points', h->>'number'; end if;
      tb := tb + v;
      v := coalesce((h->'extras'->'teamPoints'->>'white')::int, 0);
      if v < 0 or v > 40 then raise exception 'Hole % has invalid team points', h->>'number'; end if;
      tw := tw + v;
    end if;
    insert into golfbuddy.round_holes(round_id, hole_number, par, wolf_seat, partner_seat, lone_wolf, strokes, points, extras, comment)
    values (rid, (h->>'number')::int, (h->>'par')::int,
            case when fmt = 'wolf' then (h->>'wolfSeat')::int end,
            case when fmt = 'wolf' then nullif(h->>'partnerSeat', '')::int end,
            fmt = 'wolf' and coalesce((h->>'loneWolf')::boolean, false),
            h->'strokes', h->'points',
            case when fmt = 'points' then coalesce(h->'extras', '{}'::jsonb) else '{}'::jsonb end,
            nullif(left(trim(h->>'comment'), 500), ''));
  end loop;

  if fmt = 'points' then
    update golfbuddy.rounds set team_points = jsonb_build_object('black', tb, 'white', tw) where id = rid;
  end if;

  for i in 0..n-1 loop
    team := case when fmt = 'points' then p->'teams'->>i end;
    insert into golfbuddy.round_players(round_id, seat, name, team, result, total_points, total_strokes)
    values (rid, i, left(trim(p->'players'->>i), 40), team,
            case when team is null then null
                 when tb = tw then 'tie'
                 when (team = 'black') = (tb > tw) then 'win'
                 else 'loss' end,
            pts[i+1], strk[i+1]);
  end loop;
  return rid;
end;
$$;

create or replace function public.golf_round(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'format', r.format, 'playedOn', r.played_on, 'submittedBy', r.submitted_by,
    'settings', r.settings, 'teamPoints', r.team_points,
    'course', jsonb_build_object('id', c.id, 'name', c.name, 'city', c.city, 'state', c.state),
    'players', (select jsonb_agg(jsonb_build_object('seat', p.seat, 'name', p.name, 'team', p.team,
        'result', p.result, 'points', p.total_points, 'strokes', p.total_strokes) order by p.seat)
      from golfbuddy.round_players p where p.round_id = r.id),
    'holes', (select jsonb_agg(jsonb_build_object('number', h.hole_number, 'par', h.par,
        'wolfSeat', h.wolf_seat, 'partnerSeat', h.partner_seat, 'loneWolf', h.lone_wolf,
        'strokes', h.strokes, 'points', h.points, 'extras', h.extras, 'comment', h.comment) order by h.hole_number)
      from golfbuddy.round_holes h where h.round_id = r.id))
  from golfbuddy.rounds r join golfbuddy.courses c on c.id = r.course_id
  where r.id = p_id;
$$;

create or replace function public.golf_recent_rounds(p_limit int default 10) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'playedOn' desc, x->>'createdAt' desc), '[]'::jsonb) from (
    select jsonb_build_object('id', r.id, 'format', r.format, 'playedOn', r.played_on, 'createdAt', r.created_at,
      'course', c.name,
      'winner', case
        when r.format = 'points' then
          case when (r.team_points->>'black')::int > (r.team_points->>'white')::int then 'Black Belt'
               when (r.team_points->>'black')::int < (r.team_points->>'white')::int then 'White Belt'
               else null end
        else (select p.name from golfbuddy.round_players p where p.round_id = r.id
              order by p.total_points desc, p.total_strokes asc limit 1) end,
      'players', (select string_agg(p.name, ', ' order by p.seat) from golfbuddy.round_players p where p.round_id = r.id)) x
    from golfbuddy.rounds r join golfbuddy.courses c on c.id = r.course_id
    order by r.played_on desc, r.created_at desc
    limit least(greatest(p_limit, 1), 50)
  ) s;
$$;

-- Player standings for one game and year. Wolf: total points. Team Points: team record + bonus points.
create or replace function public.golf_leaderboard(p_year int default null, p_format text default 'wolf') returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by (case when p_format = 'points' then (x->>'wins')::int else (x->>'points')::int end) desc, (x->>'points')::int desc, (x->>'avgStrokes')::numeric asc), '[]'::jsonb) from (
    select jsonb_build_object(
      'name', min(p.name),
      'rounds', count(*),
      'points', sum(p.total_points),
      'wins', case when p_format = 'points' then count(*) filter (where p.result = 'win')
                   else count(*) filter (where p.total_points = (select max(q.total_points) from golfbuddy.round_players q where q.round_id = p.round_id)) end,
      'losses', count(*) filter (where p.result = 'loss'),
      'ties', count(*) filter (where p.result = 'tie'),
      'avgStrokes', round(avg(p.total_strokes), 1)) x
    from golfbuddy.round_players p join golfbuddy.rounds r on r.id = p.round_id
    where extract(year from r.played_on) = coalesce(p_year, extract(year from current_date))
      and r.format = coalesce(p_format, 'wolf')
    group by lower(trim(p.name))
  ) s;
$$;

-- Black Belt vs White Belt season record for the Team Points game.
create or replace function public.golf_team_record(p_year int default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'rounds', count(*),
    'blackWins', count(*) filter (where (team_points->>'black')::int > (team_points->>'white')::int),
    'whiteWins', count(*) filter (where (team_points->>'white')::int > (team_points->>'black')::int),
    'ties', count(*) filter (where (team_points->>'white')::int = (team_points->>'black')::int),
    'blackPoints', coalesce(sum((team_points->>'black')::int), 0),
    'whitePoints', coalesce(sum((team_points->>'white')::int), 0))
  from golfbuddy.rounds
  where format = 'points' and team_points is not null
    and extract(year from played_on) = coalesce(p_year, extract(year from current_date));
$$;

drop function if exists public.golf_leaderboard(int);
revoke all on function public.golf_courses(), public.golf_submit_round(jsonb), public.golf_round(uuid),
  public.golf_recent_rounds(int), public.golf_leaderboard(int, text), public.golf_team_record(int) from public;
grant execute on function public.golf_courses(), public.golf_submit_round(jsonb), public.golf_round(uuid),
  public.golf_recent_rounds(int), public.golf_leaderboard(int, text), public.golf_team_record(int) to anon, authenticated;
