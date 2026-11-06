-- Golf Buddy: player database (directory + profiles).
-- Run after golfbuddy-shot-stats.sql. Safe to re-run.
--
-- The players table (from the original golfbuddy schema, extended in golfbuddy-admin.sql) is the
-- player database. This adds:
--   nickname, tees            shown on the public player pages
--   one row per name          names match rounds case-insensitively, so duplicates are blocked
--   golf_players / golf_player  public directory and profile reads, behind the group PIN.
--                               They never return email, phone, notes or tags (control panel only).
--   golf_admin                 saves nickname and tees, and 'import_names' adds everyone who has
--                               played but is not in the list yet.

alter table golfbuddy.players add column if not exists nickname text check (char_length(nickname) <= 40);
alter table golfbuddy.players add column if not exists tees text check (tees in ('white', 'blue', 'black'));
create unique index if not exists players_name_key on golfbuddy.players (lower(trim(name)));

-- ---------- Directory: everyone in the list plus anyone who has posted a round ----------
create or replace function golfbuddy.golf_players() returns jsonb
language sql stable set search_path = '' as $$
  with played as (
    select lower(trim(rp.name)) as k, min(rp.name) as name, count(*) as rounds, max(r.played_on) as last_played,
           count(*) filter (where rp.result = 'win') as wins,
           count(*) filter (where rp.result = 'loss') as losses,
           count(*) filter (where rp.result = 'tie') as ties
    from golfbuddy.round_players rp join golfbuddy.rounds r on r.id = rp.round_id
    group by lower(trim(rp.name))
  ),
  listed as (
    select lower(trim(pl.name)) as k, pl.name, pl.nickname, pl.handicap, pl.tees, coalesce(pl.is_active, true) as active
    from golfbuddy.players pl
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', coalesce(l.name, p.name),
    'nickname', l.nickname,
    'handicap', l.handicap,
    'tees', l.tees,
    'inList', l.k is not null,
    'active', coalesce(l.active, true),
    'rounds', coalesce(p.rounds, 0),
    'lastPlayed', p.last_played,
    'wins', coalesce(p.wins, 0), 'losses', coalesce(p.losses, 0), 'ties', coalesce(p.ties, 0)
  ) order by coalesce(l.name, p.name)), '[]'::jsonb)
  from listed l full join played p on p.k = l.k
  where coalesce(l.active, true) or p.k is not null;
$$;

-- ---------- Profile for one name ----------
create or replace function golfbuddy.golf_player(p_name text) returns jsonb
language sql stable set search_path = '' as $$
  with me as (
    select rp.round_id, rp.seat, rp.team, rp.result, rp.total_points, rp.total_strokes, rp.name
    from golfbuddy.round_players rp
    where lower(trim(rp.name)) = lower(trim(p_name))
  ),
  info as (
    select pl.name, pl.nickname, pl.handicap, pl.tees, pl.created_at
    from golfbuddy.players pl where lower(trim(pl.name)) = lower(trim(p_name)) limit 1
  )
  select case when not exists (select 1 from me) and not exists (select 1 from info) then null else jsonb_build_object(
    'name', coalesce((select name from info), (select min(name) from me)),
    'nickname', (select nickname from info),
    'handicap', (select handicap from info),
    'tees', (select tees from info),
    'inList', exists (select 1 from info),
    'memberSince', (select created_at from info),
    'stats', (select x from jsonb_array_elements(golfbuddy.golf_player_stats(null)) x
              where lower(trim(x->>'name')) = lower(trim(p_name)) limit 1),
    'formats', (select coalesce(jsonb_object_agg(f.format, f.totals), '{}'::jsonb) from (
      select r.format, jsonb_build_object(
        'rounds', count(*),
        'wins', count(*) filter (where me.result = 'win' or (r.format = 'wolf' and me.total_points =
                  (select max(q.total_points) from golfbuddy.round_players q where q.round_id = me.round_id))),
        'losses', count(*) filter (where me.result = 'loss'),
        'ties', count(*) filter (where me.result = 'tie'),
        'points', sum(me.total_points),
        'avgStrokes', round(avg(me.total_strokes) filter (where coalesce(r.settings->'rules'->>'scramble', '0') not in ('1', 'true')), 1)
      ) as totals
      from me join golfbuddy.rounds r on r.id = me.round_id group by r.format) f),
    'partners', (select coalesce(jsonb_agg(x order by (x->>'rounds')::int desc, x->>'name'), '[]'::jsonb) from (
      select jsonb_build_object('name', min(mate.name), 'rounds', count(*),
        'wins', count(*) filter (where me.result = 'win'),
        'losses', count(*) filter (where me.result = 'loss'),
        'ties', count(*) filter (where me.result = 'tie')) as x
      from me join golfbuddy.round_players mate
        on mate.round_id = me.round_id and mate.team = me.team and mate.seat <> me.seat
      where me.team is not null
      group by lower(trim(mate.name))) s),
    'rounds', (select coalesce(jsonb_agg(x order by x->>'playedOn' desc, x->>'createdAt' desc), '[]'::jsonb) from (
      select jsonb_build_object('id', r.id, 'format', r.format, 'playedOn', r.played_on, 'createdAt', r.created_at,
        'course', c.name, 'team', me.team, 'result', me.result, 'points', me.total_points, 'strokes', me.total_strokes,
        'scramble', coalesce(r.settings->'rules'->>'scramble', '0') in ('1', 'true'),
        'with', (select string_agg(o.name, ', ' order by o.seat) from golfbuddy.round_players o
                 where o.round_id = r.id and o.seat <> me.seat)) as x
      from me join golfbuddy.rounds r on r.id = me.round_id join golfbuddy.courses c on c.id = r.course_id
      order by r.played_on desc, r.created_at desc limit 25) s)
  ) end;
$$;

revoke all on function golfbuddy.golf_players(), golfbuddy.golf_player(text) from public, anon, authenticated;

create or replace function public.golf_players(p_pin text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not golfbuddy.can_view(p_pin) then return null; end if;
  return golfbuddy.golf_players();
end;
$$;

create or replace function public.golf_player(p_name text, p_pin text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not golfbuddy.can_view(p_pin) then return null; end if;
  return golfbuddy.golf_player(left(p_name, 40));
end;
$$;

revoke all on function public.golf_players(text), public.golf_player(text, text) from public;
grant execute on function public.golf_players(text), public.golf_player(text, text) to anon, authenticated;

-- ---------- Control panel: nickname, tees, no duplicate names, import names from rounds ----------
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
        'id', pl.id, 'name', pl.name, 'nickname', pl.nickname, 'tees', pl.tees, 'email', pl.email, 'phone', pl.phone, 'handicap', pl.handicap,
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
