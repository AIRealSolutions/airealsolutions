-- Golf Buddy: player sign-in (/golf/me) and name editing.
-- Run after golfbuddy-players.sql. Safe to re-run.
--
-- Sign-in: name + personal PIN. The organizer creates a one-time 6-digit sign-in code in the
-- control panel and texts it to the player; the player signs in with it once and chooses their own
-- 4-8 digit PIN (the organizer never sees it). Secrets are stored only as salted SHA-256 hashes.
-- Sessions are random 64-character tokens kept in an httpOnly cookie; only their hash is stored.
-- 5 wrong tries for one player pauses that player's sign-in for 15 minutes.
--
-- Signed-in players can edit their name, nickname, tees, email and phone. Handicap stays with the
-- organizer (it drives fair pairings). Renaming moves the player's posted rounds to the new name.

alter table golfbuddy.players add column if not exists login_pin_hash text;
alter table golfbuddy.players add column if not exists login_code_hash text;
alter table golfbuddy.players add column if not exists login_code_expires timestamptz;

create table if not exists golfbuddy.player_sessions (
  token_hash text primary key,
  player_id integer not null references golfbuddy.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '180 days'
);
create index if not exists player_sessions_player_idx on golfbuddy.player_sessions (player_id);
alter table golfbuddy.player_sessions enable row level security;

create table if not exists golfbuddy.player_login_attempts (
  id bigint generated always as identity primary key,
  player_id integer not null references golfbuddy.players(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists player_login_attempts_idx on golfbuddy.player_login_attempts (player_id, at desc);
alter table golfbuddy.player_login_attempts enable row level security;

-- ---------- Helpers (not callable from the API) ----------
create or replace function golfbuddy.player_secret_hash(p_id integer, p_secret text) returns text
language sql stable set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to(
    (select s.pin_salt from golfbuddy.settings s where s.id = 1) || ':player:' || p_id || ':' || coalesce(p_secret, ''), 'UTF8')), 'hex');
$$;

create or replace function golfbuddy.token_hash(p_token text) returns text
language sql stable set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

-- 6 random digits from gen_random_uuid (cryptographically random).
create or replace function golfbuddy.new_login_code() returns text
language sql volatile set search_path = '' as $$
  select lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 1000000)::text, 6, '0');
$$;

create or replace function golfbuddy.session_player(p_token text) returns integer
language sql stable set search_path = '' as $$
  select s.player_id from golfbuddy.player_sessions s
  where coalesce(p_token, '') <> '' and s.token_hash = golfbuddy.token_hash(p_token) and s.expires_at > now();
$$;

-- Renames a player and moves their posted rounds to the new name.
create or replace function golfbuddy.rename_player(p_id integer, p_name text) returns void
language plpgsql volatile set search_path = '' as $$
declare
  old_name text := (select pl.name from golfbuddy.players pl where pl.id = p_id);
  new_name text := trim(coalesce(p_name, ''));
begin
  if old_name is null or new_name = '' or old_name = new_name then return; end if;
  update golfbuddy.round_players set name = new_name where lower(trim(name)) = lower(trim(old_name));
  update golfbuddy.players set name = new_name, updated_at = now() where id = p_id;
end;
$$;

create or replace function golfbuddy.me_json(p_id integer) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', pl.id, 'name', pl.name, 'nickname', pl.nickname, 'tees', pl.tees,
    'email', pl.email, 'phone', pl.phone, 'handicap', pl.handicap, 'hasPin', pl.login_pin_hash is not null)
  from golfbuddy.players pl where pl.id = p_id;
$$;

revoke all on function golfbuddy.player_secret_hash(integer, text), golfbuddy.token_hash(text), golfbuddy.new_login_code(),
  golfbuddy.session_player(text), golfbuddy.rename_player(integer, text), golfbuddy.me_json(integer)
  from public, anon, authenticated;

-- ---------- Public API ----------
create or replace function public.golf_player_login(p_name text, p_secret text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  pl golfbuddy.players;
  secret text := regexp_replace(coalesce(p_secret, ''), '\D', '', 'g');
  tok text;
begin
  select * into pl from golfbuddy.players
  where lower(trim(name)) = lower(trim(coalesce(p_name, ''))) and coalesce(is_active, true)
  limit 1;
  if not found then return jsonb_build_object('error', 'That name is not in the player list. Ask the organizer to add you.'); end if;
  if (select count(*) from golfbuddy.player_login_attempts a where a.player_id = pl.id and a.at > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('error', 'Too many tries. Wait 15 minutes and try again.');
  end if;
  if pl.login_pin_hash is null and (pl.login_code_hash is null or pl.login_code_expires <= now()) then
    return jsonb_build_object('error', 'Your sign-in is not set up yet. Ask the organizer for a sign-in code.');
  end if;
  if not ((pl.login_pin_hash is not null and golfbuddy.player_secret_hash(pl.id, secret) = pl.login_pin_hash)
       or (pl.login_code_hash is not null and pl.login_code_expires > now()
           and golfbuddy.player_secret_hash(pl.id, 'code:' || secret) = pl.login_code_hash)) then
    insert into golfbuddy.player_login_attempts (player_id) values (pl.id);
    delete from golfbuddy.player_login_attempts where at < now() - interval '1 day';
    return jsonb_build_object('error', 'Wrong PIN or sign-in code.');
  end if;

  delete from golfbuddy.player_login_attempts where player_id = pl.id;
  delete from golfbuddy.player_sessions where expires_at < now();
  tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into golfbuddy.player_sessions (token_hash, player_id) values (golfbuddy.token_hash(tok), pl.id);
  return jsonb_build_object('token', tok, 'name', pl.name, 'mustSetPin', pl.login_pin_hash is null);
end;
$$;

create or replace function public.golf_me(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare pid integer := golfbuddy.session_player(p_token);
begin
  if pid is null then return jsonb_build_object('error', 'signed_out'); end if;
  return golfbuddy.me_json(pid);
end;
$$;

create or replace function public.golf_me_update(p_token text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  pid integer := golfbuddy.session_player(p_token);
  cur golfbuddy.players;
  new_name text := trim(coalesce(p->>'name', ''));
  new_pin text := coalesce(p->>'newPin', '');
  v_email text := nullif(lower(trim(coalesce(p->>'email', ''))), '');
begin
  if pid is null then return jsonb_build_object('error', 'signed_out'); end if;
  select * into cur from golfbuddy.players where id = pid;
  if char_length(new_name) not between 1 and 40 then return jsonb_build_object('error', 'Your name is required (up to 40 characters).'); end if;
  if char_length(trim(coalesce(p->>'nickname', ''))) > 40 then return jsonb_build_object('error', 'Nickname is up to 40 characters.'); end if;
  if coalesce(nullif(p->>'tees', ''), 'white') not in ('white', 'blue', 'black') then return jsonb_build_object('error', 'Pick white, blue or black tees.'); end if;
  if v_email is not null and (char_length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    return jsonb_build_object('error', 'That email address does not look right.');
  end if;
  if char_length(trim(coalesce(p->>'phone', ''))) > 30 then return jsonb_build_object('error', 'Phone is up to 30 characters.'); end if;
  if new_pin <> '' and new_pin !~ '^\d{4,8}$' then return jsonb_build_object('error', 'Your PIN must be 4 to 8 digits.'); end if;
  if cur.login_pin_hash is null and new_pin = '' then return jsonb_build_object('error', 'Choose a PIN so you can sign in next time.'); end if;

  -- A new name (not just different capitals) must not belong to anyone else, in the list or in posted rounds.
  if lower(new_name) <> lower(trim(cur.name)) and (
       exists (select 1 from golfbuddy.players pl where pl.id <> pid and lower(trim(pl.name)) = lower(new_name))
    or exists (select 1 from golfbuddy.round_players rp where lower(trim(rp.name)) = lower(new_name))) then
    return jsonb_build_object('error', 'Someone already plays under that name. Ask the organizer if those rounds are yours.');
  end if;

  perform golfbuddy.rename_player(pid, new_name);
  update golfbuddy.players set
    nickname = nullif(trim(p->>'nickname'), ''),
    tees = nullif(p->>'tees', ''),
    email = v_email,
    phone = nullif(trim(p->>'phone'), ''),
    updated_at = now()
  where id = pid;
  if new_pin <> '' then
    update golfbuddy.players
       set login_pin_hash = golfbuddy.player_secret_hash(pid, new_pin), login_code_hash = null, login_code_expires = null
     where id = pid;
  end if;
  return golfbuddy.me_json(pid);
end;
$$;

create or replace function public.golf_player_logout(p_token text) returns jsonb
language sql volatile security definer set search_path = '' as $$
  delete from golfbuddy.player_sessions where token_hash = golfbuddy.token_hash(p_token);
  select '{}'::jsonb;
$$;

revoke all on function public.golf_player_login(text, text), public.golf_me(text), public.golf_me_update(text, jsonb),
  public.golf_player_logout(text) from public;
grant execute on function public.golf_player_login(text, text), public.golf_me(text), public.golf_me_update(text, jsonb),
  public.golf_player_logout(text) to anon, authenticated;

-- ---------- Control panel: renames move history, sign-in codes, reset sign-in ----------
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
