-- Golf Buddy: GPS shot tracking and course maps.
-- Run after golfbuddy-player-login.sql. Safe to re-run.
--
-- Course maps: tee and green positions on each hole (set once in the control panel's Course maps tab).
-- Shots: captain's choice holes can carry GPS spots next to whose ball was used:
--   round_holes.extras.shots     = {"black": [seat, ...], "white": [...]}
--   round_holes.extras.shotSpots = {"black": [[lat, lng] | null, ...], "white": [...]}  (where each shot was hit from)
-- golf_submit_round already stores points-game extras as sent. Shot distance = from one spot to the next
-- (the last shot runs to the green). Player stats add drives, average and longest drive.

alter table golfbuddy.holes add column if not exists tee_lat double precision;
alter table golfbuddy.holes add column if not exists tee_lng double precision;
alter table golfbuddy.holes add column if not exists green_lat double precision;
alter table golfbuddy.holes add column if not exists green_lng double precision;

-- Distance in yards between two [lat, lng] JSON pairs (haversine). Null when either is missing.
create or replace function golfbuddy.yards(a jsonb, b jsonb) returns integer
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(a) = 'array' and jsonb_typeof(b) = 'array' then
    round(2 * 6371008.8 * asin(sqrt(
      power(sin(radians(((b->>0)::float8 - (a->>0)::float8) / 2)), 2)
      + cos(radians((a->>0)::float8)) * cos(radians((b->>0)::float8))
        * power(sin(radians(((b->>1)::float8 - (a->>1)::float8) / 2)), 2))) / 0.9144)::int
  end;
$$;

-- One coordinate from a [lat, lng] JSON pair, checked against +-limit. Null when missing or out of range.
create or replace function golfbuddy.coord(pair jsonb, idx integer, lim float8) returns float8
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(pair) = 'array' and jsonb_typeof(pair->idx) = 'number'
              and abs((pair->>idx)::float8) <= lim then round((pair->>idx)::numeric, 7)::float8 end;
$$;

revoke all on function golfbuddy.yards(jsonb, jsonb), golfbuddy.coord(jsonb, integer, float8) from public, anon, authenticated;

-- Courses now include each hole's tee and green.
create or replace function golfbuddy.golf_courses() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'city', c.city, 'state', c.state, 'par', c.par,
    'holes', (select coalesce(jsonb_agg(jsonb_build_object(
        'number', h.hole_number, 'par', h.par, 'handicap', h.handicap,
        'yardsWhite', h.yards_white, 'yardsBlue', h.yards_blue, 'yardsBlack', h.yards_black,
        'tee', case when h.tee_lat is not null then jsonb_build_array(h.tee_lat, h.tee_lng) end,
        'green', case when h.green_lat is not null then jsonb_build_array(h.green_lat, h.green_lng) end
      ) order by h.hole_number), '[]'::jsonb) from golfbuddy.holes h where h.course_id = c.id)
  ) order by c.name), '[]'::jsonb) from golfbuddy.courses c;
$$;
revoke all on function golfbuddy.golf_courses() from public, anon, authenticated;

-- Player stats with drive distances.
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
  -- GPS: a drive is the first shot on a par 4 or 5 with spots for shots 1 and 2.
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

-- Control panel: 'save_layout' stores a course's tee and green positions.
create or replace function public.golf_admin(p_pin text, p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  pid int;
  g jsonb;
  code text;
  extra jsonb := '{}'::jsonb;
begin
  if golfbuddy.pin_locked() then return jsonb_build_object('error', 'Too many wrong PINs. Try again in 15 minutes.'); end if;
  if coalesce(golfbuddy.pin_role(p_pin), '') <> 'admin' then return jsonb_build_object('error', 'Wrong admin PIN.', 'pin', true); end if;

  if p_action = 'save_settings' then
    g := p->'games';
    if jsonb_typeof(g) <> 'object' or not (g ? 'points' and g ? 'wolf') then raise exception 'Games are missing'; end if;
    if exists (select 1 from jsonb_each_text(g->'points'->'rules') r where r.value !~ '^\d{1,2}$')
       or exists (select 1 from jsonb_each_text(g->'wolf'->'rules') r where r.value !~ '^\d{1,2}$') then
      raise exception 'Point values must be whole numbers from 0 to 99';
    end if;
    if not (coalesce((g->'points'->>'enabled')::boolean, false) or coalesce((g->'wolf'->>'enabled')::boolean, false)) then
      raise exception 'Leave at least one game turned on';
    end if;
    update golfbuddy.settings set
      bet_per_point = coalesce((p->>'betPerPoint')::numeric, bet_per_point),
      default_game = coalesce(p->>'defaultGame', default_game),
      games = jsonb_build_object(
        'points', jsonb_build_object('enabled', coalesce((g->'points'->>'enabled')::boolean, true), 'rules', g->'points'->'rules'),
        'wolf', jsonb_build_object('enabled', coalesce((g->'wolf'->>'enabled')::boolean, true), 'rules', g->'wolf'->'rules')),
      updated_at = now()
    where id = 1;

  elsif p_action = 'set_pins' then
    if nullif(p->>'groupPin', '') is not null then
      if (p->>'groupPin') !~ '^\d{4,8}$' then raise exception 'PINs are 4 to 8 digits'; end if;
      update golfbuddy.settings set group_pin_hash = golfbuddy.pin_hash(p->>'groupPin'), updated_at = now() where id = 1;
    end if;
    if nullif(p->>'adminPin', '') is not null then
      if (p->>'adminPin') !~ '^\d{4,8}$' then raise exception 'PINs are 4 to 8 digits'; end if;
      update golfbuddy.settings set admin_pin_hash = golfbuddy.pin_hash(p->>'adminPin'), updated_at = now() where id = 1;
    end if;
    if (select group_pin_hash = admin_pin_hash from golfbuddy.settings where id = 1) then
      raise exception 'The group PIN and admin PIN must be different';
    end if;

  elsif p_action = 'save_player' then
    if char_length(trim(coalesce(p->>'name', ''))) not between 1 and 40 then raise exception 'Name is required (up to 40 characters)'; end if;
    if char_length(trim(coalesce(p->>'nickname', ''))) > 40 then raise exception 'Nickname is up to 40 characters'; end if;
    if coalesce(nullif(p->>'tees', ''), 'white') not in ('white', 'blue', 'black') then raise exception 'Tees must be white, blue or black'; end if;
    pid := nullif(p->>'id', '')::int;
    if exists (select 1 from golfbuddy.players pl
               where lower(trim(pl.name)) = lower(trim(p->>'name')) and pl.id is distinct from pid) then
      raise exception 'A player named % is already in the list', trim(p->>'name');
    end if;
    if pid is null then
      insert into golfbuddy.players (name, nickname, tees, email, phone, handicap, notes, tags, is_active)
      values (trim(p->>'name'), nullif(trim(p->>'nickname'), ''), nullif(p->>'tees', ''),
              nullif(lower(trim(p->>'email')), ''), nullif(trim(p->>'phone'), ''),
              nullif(p->>'handicap', '')::numeric, nullif(trim(p->>'notes'), ''),
              coalesce(array(select trim(t) from jsonb_array_elements_text(p->'tags') t where trim(t) <> ''), '{}'),
              coalesce((p->>'isActive')::boolean, true));
    else
      -- Renaming also moves their posted rounds to the new name (and combines them with any rounds
      -- already posted under that name).
      perform golfbuddy.rename_player(pid, p->>'name');
      update golfbuddy.players set
        name = trim(p->>'name'), nickname = nullif(trim(p->>'nickname'), ''), tees = nullif(p->>'tees', ''),
        email = nullif(lower(trim(p->>'email')), ''), phone = nullif(trim(p->>'phone'), ''),
        handicap = nullif(p->>'handicap', '')::numeric, notes = nullif(trim(p->>'notes'), ''),
        tags = coalesce(array(select trim(t) from jsonb_array_elements_text(p->'tags') t where trim(t) <> ''), '{}'),
        is_active = coalesce((p->>'isActive')::boolean, true), updated_at = now()
      where id = pid;
    end if;

  elsif p_action = 'import_names' then
    -- Adds everyone who has played but is not in the list yet.
    insert into golfbuddy.players (name, is_active)
    select min(trim(rp.name)), true
    from golfbuddy.round_players rp
    where not exists (select 1 from golfbuddy.players pl where lower(trim(pl.name)) = lower(trim(rp.name)))
    group by lower(trim(rp.name));

  elsif p_action = 'login_code' then
    -- One-time sign-in code for /golf/me (good for 14 days, until the player sets a PIN).
    pid := (p->>'id')::int;
    if not exists (select 1 from golfbuddy.players where id = pid) then raise exception 'Unknown player'; end if;
    code := golfbuddy.new_login_code();
    update golfbuddy.players
       set login_code_hash = golfbuddy.player_secret_hash(pid, 'code:' || code), login_code_expires = now() + interval '14 days'
     where id = pid;
    extra := jsonb_build_object('loginCode', code, 'loginCodeFor', (select name from golfbuddy.players where id = pid));

  elsif p_action = 'reset_login' then
    pid := (p->>'id')::int;
    update golfbuddy.players set login_pin_hash = null, login_code_hash = null, login_code_expires = null where id = pid;
    delete from golfbuddy.player_sessions where player_id = pid;

  elsif p_action = 'save_layout' then
    -- Tee and green positions for a course: {courseId, holes: [{number, tee: [lat, lng] | null, green: [lat, lng] | null}]}
    if not exists (select 1 from golfbuddy.courses where id = (p->>'courseId')::int) then raise exception 'Unknown course'; end if;
    update golfbuddy.holes h set
      tee_lat = golfbuddy.coord(x.v->'tee', 0, 90), tee_lng = golfbuddy.coord(x.v->'tee', 1, 180),
      green_lat = golfbuddy.coord(x.v->'green', 0, 90), green_lng = golfbuddy.coord(x.v->'green', 1, 180)
    from jsonb_array_elements(coalesce(p->'holes', '[]'::jsonb)) x(v)
    where h.course_id = (p->>'courseId')::int and h.hole_number = (x.v->>'number')::int;

  elsif p_action = 'delete_player' then
    delete from golfbuddy.players where id = (p->>'id')::int;

  elsif p_action = 'delete_round' then
    delete from golfbuddy.rounds where id = (p->>'id')::uuid;

  elsif p_action <> 'get' then
    raise exception 'Unknown action';
  end if;

  return extra || jsonb_build_object(
    'settings', golfbuddy.public_settings() || jsonb_build_object(
      'groupPinSet', (select group_pin_hash is not null from golfbuddy.settings where id = 1)),
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', pl.id, 'name', pl.name, 'nickname', pl.nickname,
        'hasLogin', pl.login_pin_hash is not null,
        'codePending', pl.login_pin_hash is null and pl.login_code_expires > now(), 'tees', pl.tees, 'email', pl.email, 'phone', pl.phone, 'handicap', pl.handicap,
        'notes', pl.notes, 'tags', to_jsonb(pl.tags), 'isActive', pl.is_active, 'createdAt', pl.created_at,
        'rounds', st.rounds, 'lastPlayed', st.last_played, 'points', st.points
      ) order by pl.is_active desc, pl.name), '[]'::jsonb)
      from golfbuddy.players pl
      left join lateral (
        select count(*) rounds, max(r.played_on) last_played, coalesce(sum(rp.total_points), 0) points
        from golfbuddy.round_players rp join golfbuddy.rounds r on r.id = rp.round_id
        where lower(trim(rp.name)) = lower(trim(pl.name))
      ) st on true),
    'unknownNames', (select coalesce(jsonb_agg(distinct rp.name), '[]'::jsonb)
      from golfbuddy.round_players rp
      where not exists (select 1 from golfbuddy.players pl where lower(trim(pl.name)) = lower(trim(rp.name)))),
    'rounds', (select coalesce(jsonb_agg(x order by x->>'playedOn' desc, x->>'createdAt' desc), '[]'::jsonb) from (
      select jsonb_build_object('id', r.id, 'format', r.format, 'playedOn', r.played_on, 'createdAt', r.created_at,
        'course', c.name, 'submittedBy', r.submitted_by,
        'players', (select string_agg(rp.name, ', ' order by rp.seat) from golfbuddy.round_players rp where rp.round_id = r.id)) x
      from golfbuddy.rounds r join golfbuddy.courses c on c.id = r.course_id
      order by r.played_on desc, r.created_at desc limit 50) s));
end;
$$;
