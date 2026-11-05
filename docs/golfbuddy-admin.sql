-- Golf Buddy: PINs, settings (bet price, games, rule values), players CRM and admin panel.
-- Run after golfbuddy-database.sql. Safe to re-run.
--
-- PINs are stored only as salted SHA-256 hashes. Two PINs:
--   group PIN  -> needed to post a round once it is set (shared with the golf group)
--   admin PIN  -> opens /golf/admin (also works anywhere the group PIN does)
-- Wrong PINs are logged; after 20 wrong PINs in 15 minutes all PIN checks pause for 15 minutes.
-- Initial PIN hashes are set separately (not in this file) and changed from the control panel.

create table if not exists golfbuddy.settings (
  id smallint primary key default 1 check (id = 1),
  pin_salt text not null default replace(gen_random_uuid()::text, '-', ''),
  group_pin_hash text,
  admin_pin_hash text,
  bet_per_point numeric(8, 2) not null default 0 check (bet_per_point between 0 and 1000),
  default_game text not null default 'points' check (default_game in ('points', 'wolf')),
  games jsonb not null default '{
    "points": {"enabled": true, "rules": {"bestBall": 1, "birdie": 1, "eagleBonus": 1, "sandSave": 1, "closest": 1}},
    "wolf":   {"enabled": true, "rules": {"teamWin": 2, "opponentsWin": 3, "loneWin": 4, "loneLoss": 1}}
  }'::jsonb,
  updated_at timestamptz not null default now()
);
insert into golfbuddy.settings (id) values (1) on conflict (id) do nothing;
alter table golfbuddy.settings enable row level security;

create table if not exists golfbuddy.pin_attempts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now()
);
create index if not exists pin_attempts_at_idx on golfbuddy.pin_attempts (at desc);
alter table golfbuddy.pin_attempts enable row level security;

-- Players CRM additions (table already exists from the original golfbuddy schema).
alter table golfbuddy.players add column if not exists notes text check (char_length(notes) <= 2000);
alter table golfbuddy.players add column if not exists tags text[] not null default '{}';
alter table golfbuddy.players alter column handicap drop default;

-- Helpers (not callable from the API).
create or replace function golfbuddy.pin_hash(p_pin text) returns text
language sql stable set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to((select s.pin_salt from golfbuddy.settings s where s.id = 1) || ':' || coalesce(p_pin, ''), 'UTF8')), 'hex');
$$;

create or replace function golfbuddy.pin_locked() returns boolean
language sql stable set search_path = '' as $$
  select count(*) >= 20 from golfbuddy.pin_attempts where at > now() - interval '15 minutes';
$$;

-- Returns 'admin', 'group' or null. Logs a wrong PIN. Callers must not raise afterwards,
-- or the log row is rolled back.
create or replace function golfbuddy.pin_role(p_pin text) returns text
language plpgsql volatile set search_path = '' as $$
declare
  h text := golfbuddy.pin_hash(p_pin);
  s golfbuddy.settings;
begin
  select * into s from golfbuddy.settings where id = 1;
  if s.admin_pin_hash is not null and h = s.admin_pin_hash then return 'admin'; end if;
  if s.group_pin_hash is not null and h = s.group_pin_hash then return 'group'; end if;
  insert into golfbuddy.pin_attempts default values;
  delete from golfbuddy.pin_attempts where at < now() - interval '1 day';
  return null;
end;
$$;

create or replace function golfbuddy.public_settings() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('betPerPoint', s.bet_per_point, 'defaultGame', s.default_game, 'games', s.games,
                            'pinRequired', s.group_pin_hash is not null)
  from golfbuddy.settings s where s.id = 1;
$$;

-- ---------- Public API ----------
create or replace function public.golf_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select golfbuddy.public_settings();
$$;

create or replace function public.golf_roster() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(p.name order by p.name), '[]'::jsonb)
  from golfbuddy.players p where p.is_active;
$$;

create or replace function public.golf_check_pin(p_pin text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare r text;
begin
  if golfbuddy.pin_locked() then return jsonb_build_object('error', 'Too many wrong PINs. Try again in 15 minutes.'); end if;
  r := golfbuddy.pin_role(p_pin);
  if r is null then return jsonb_build_object('error', 'Wrong PIN.'); end if;
  return jsonb_build_object('role', r);
end;
$$;

-- Same validation as before, plus the group PIN and a bet/rules snapshot from settings.
drop function if exists public.golf_submit_round(jsonb);
create function public.golf_submit_round(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  rid uuid;
  fmt text := coalesce(p->>'format', 'wolf');
  n int := jsonb_array_length(coalesce(p->'players', '[]'::jsonb));
  s golfbuddy.settings;
  h jsonb;
  i int;
  pts int[];
  strk int[];
  v int;
  tb int := 0;
  tw int := 0;
  team text;
begin
  select * into s from golfbuddy.settings where id = 1;
  -- Posting needs a PIN only once a group PIN is set (the admin PIN also works).
  if s.group_pin_hash is not null then
    if golfbuddy.pin_locked() then return jsonb_build_object('error', 'Too many wrong PINs. Try again in 15 minutes.'); end if;
    if golfbuddy.pin_role(p->>'pin') is null then return jsonb_build_object('error', 'Wrong group PIN.', 'pin', true); end if;
  end if;

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
          jsonb_build_object('format', fmt, 'rules', coalesce(p->'settings'->'rules', s.games->fmt->'rules'),
                             'betPerPoint', s.bet_per_point),
          nullif(left(trim(p->>'submittedBy'), 60), ''))
  returning id into rid;

  pts := array_fill(0, array[n]);
  strk := array_fill(0, array[n]);
  for h in select * from jsonb_array_elements(p->'holes') loop
    if jsonb_array_length(h->'strokes') <> n or jsonb_array_length(h->'points') <> n then
      raise exception 'Hole % has the wrong number of scores', h->>'number';
    end if;
    for i in 0..n-1 loop
      -- A blank score is allowed (player picked up): a side only needs one score for best ball.
      v := (h->'strokes'->>i)::int;
      if v is not null then
        if v < 1 or v > 15 then raise exception 'Hole % has an invalid score', h->>'number'; end if;
        strk[i+1] := strk[i+1] + v;
      end if;
      v := coalesce((h->'points'->>i)::int, 0);
      if v < 0 or v > 60 then raise exception 'Hole % has invalid points', h->>'number'; end if;
      pts[i+1] := pts[i+1] + v;
    end loop;
    if fmt = 'points' then
      v := coalesce((h->'extras'->'teamPoints'->>'black')::int, 0);
      if v < 0 or v > 500 then raise exception 'Hole % has invalid team points', h->>'number'; end if;
      tb := tb + v;
      v := coalesce((h->'extras'->'teamPoints'->>'white')::int, 0);
      if v < 0 or v > 500 then raise exception 'Hole % has invalid team points', h->>'number'; end if;
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
  -- Success is the id as a JSON string, so older scorecards that expect a plain id keep working.
  return to_jsonb(rid::text);
end;
$$;

-- ---------- Admin API (admin PIN required) ----------
create or replace function public.golf_admin(p_pin text, p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  pid int;
  g jsonb;
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
    pid := nullif(p->>'id', '')::int;
    if pid is null then
      insert into golfbuddy.players (name, email, phone, handicap, notes, tags, is_active)
      values (trim(p->>'name'), nullif(lower(trim(p->>'email')), ''), nullif(trim(p->>'phone'), ''),
              nullif(p->>'handicap', '')::numeric, nullif(trim(p->>'notes'), ''),
              coalesce(array(select trim(t) from jsonb_array_elements_text(p->'tags') t where trim(t) <> ''), '{}'),
              coalesce((p->>'isActive')::boolean, true));
    else
      update golfbuddy.players set
        name = trim(p->>'name'), email = nullif(lower(trim(p->>'email')), ''), phone = nullif(trim(p->>'phone'), ''),
        handicap = nullif(p->>'handicap', '')::numeric, notes = nullif(trim(p->>'notes'), ''),
        tags = coalesce(array(select trim(t) from jsonb_array_elements_text(p->'tags') t where trim(t) <> ''), '{}'),
        is_active = coalesce((p->>'isActive')::boolean, true), updated_at = now()
      where id = pid;
    end if;

  elsif p_action = 'delete_player' then
    delete from golfbuddy.players where id = (p->>'id')::int;

  elsif p_action = 'delete_round' then
    delete from golfbuddy.rounds where id = (p->>'id')::uuid;

  elsif p_action <> 'get' then
    raise exception 'Unknown action';
  end if;

  return jsonb_build_object(
    'settings', golfbuddy.public_settings() || jsonb_build_object(
      'groupPinSet', (select group_pin_hash is not null from golfbuddy.settings where id = 1)),
    'players', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', pl.id, 'name', pl.name, 'email', pl.email, 'phone', pl.phone, 'handicap', pl.handicap,
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

revoke all on function golfbuddy.pin_hash(text), golfbuddy.pin_locked(), golfbuddy.pin_role(text), golfbuddy.public_settings() from public;
revoke all on function public.golf_settings(), public.golf_roster(), public.golf_check_pin(text),
  public.golf_submit_round(jsonb), public.golf_admin(text, text, jsonb) from public;
grant execute on function public.golf_settings(), public.golf_roster(), public.golf_check_pin(text),
  public.golf_submit_round(jsonb), public.golf_admin(text, text, jsonb) to anon, authenticated;
