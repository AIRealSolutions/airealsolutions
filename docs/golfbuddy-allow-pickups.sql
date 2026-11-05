-- Golf Buddy patch: allow blank scores (a player who picked up).
-- Dots / Wolf best ball only needs one score per side. Safe to re-run.
-- Also folded into golfbuddy-admin.sql.

-- Same validation as before, plus the group PIN and a bet/rules snapshot from settings.
create or replace function public.golf_submit_round(p jsonb) returns jsonb
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

grant execute on function public.golf_submit_round(jsonb) to anon, authenticated;
