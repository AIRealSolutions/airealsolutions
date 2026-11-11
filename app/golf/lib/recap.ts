// Round recap: play-by-play feed, A–D grades for the round and the MVP. Pure functions over a saved
// round, so it works on every round already in the database (no new tables).
//
// Grades are curved on the field: each part of a player's game is measured against the best player
// in this round on that part. Being level with the best earns full marks; falling a "scale" behind
// (e.g. half a stroke a hole) earns none. Weighted parts:
//   Wolf / regular Dots    scoring 40% · game points 25% · big moments 20% · consistency 15%
//   Captain's choice       shots used vs. fair share 45% · tee shots 20% · holed shots 15% · big moments 20%
// Round score 0–100 → A 80+, B 60–79, C 40–59, D under 40 (with + / – near the edges).
import type { SavedHole, SavedRound } from "./api";
import { shotYards, type Spot } from "./geo";
import { TEAM_NAMES, type Team } from "./points";
import { roundShotStats } from "./skill";

export type Letter = "A" | "B" | "C" | "D";
export type Grade = {
  seat: number;
  name: string;
  score: number; // 0–100
  letter: Letter;
  mark: string; // "A+", "B", "C–"
  line: string; // why: best parts first, one thing to work on
};
export type FeedItem = { hole: number | null; icon: string; title: string; text: string; big?: boolean };
export type Award = { icon: string; title: string; who: string; detail: string };
export type Drive = { seat: number; yds: number; hole: number };
export type Recap = { feed: FeedItem[]; grades: Grade[]; mvp: (Grade & { why: string }) | null; awards: Award[]; note: string | null };

const valid = (s: number | null | undefined): s is number => typeof s === "number" && s > 0;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const toPar = (n: number) => (n === 0 ? "E" : n > 0 ? `+${n}` : `${n}`);
const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const joinNames = (names: string[]) => (names.length <= 2 ? names.join(" & ") : `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`);

/**
 * Each value scored 0–1 against the best value in the field. `scale` is how far behind the best
 * counts as zero, so a close field all scores high and only a real gap drops to the bottom.
 */
function curve(values: (number | null)[], higherIsBetter: boolean, scale: number) {
  const known = values.filter((v): v is number => v !== null);
  if (!known.length) return values.map(() => 0.5);
  const best = higherIsBetter ? Math.max(...known) : Math.min(...known);
  const range = Math.max(...known) - Math.min(...known);
  const span = Math.max(range, scale);
  return values.map((v) => (v === null ? 0 : clamp01(1 - Math.abs(best - v) / span)));
}

function markOf(score: number): { letter: Letter; mark: string } {
  const letter: Letter = score >= 80 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : "D";
  const floor = { A: 80, B: 60, C: 40, D: 0 }[letter];
  const within = letter === "D" ? score / 40 : (score - floor) / 20;
  const sign = letter === "A" ? (score >= 93 ? "+" : score < 85 ? "–" : "") : within >= 0.67 ? "+" : within < 0.33 && letter !== "D" ? "–" : "";
  return { letter, mark: letter + sign };
}

type Line = { seat: number; name: string; team: Team | null };
type Stat = {
  holes: number;
  overPar: number;
  birdies: number;
  eagles: number;
  aces: number;
  blowups: number; // double bogey or worse
  sand: number;
  closest: number;
  bestBalls: number;
  bonus: number; // Dots personal points
  wolfPoints: number;
  loneWins: number;
  wolfWins: number; // holes won while Wolf (with a partner or alone)
  bestStreak: number; // pars or better in a row
  closing: number | null; // strokes vs. par over the last three holes played
  clutch: number; // birdies or better on the last three holes
  used: number;
  tee: number;
  holed: number;
  fair: number; // a fair share of the team's captain's choice shots
  longest: number;
  moments: number;
};

/**
 * GPS drives on par 4s and 5s: captain's choice team balls (credited to whoever hit the tee shot)
 * and regular rounds' own balls. Readings under 30 or over 450 yds are treated as GPS noise.
 */
export function roundDrives(holes: SavedHole[], greenOf: (hole: number) => Spot | null = () => null): Drive[] {
  const drives: Drive[] = [];
  const add = (h: SavedHole, spots: (Spot | null)[], seat: number | null | undefined) => {
    const yds = shotYards(spots, greenOf(h.number))[0];
    if (h.par >= 4 && yds !== null && yds >= 30 && yds <= 450 && seat !== null && seat !== undefined) drives.push({ seat, yds, hole: h.number });
  };
  for (const h of holes) {
    for (const team of ["black", "white"] as Team[]) {
      const spots = (h.extras?.shotSpots?.[team] ?? []) as (Spot | null)[];
      if (spots.some(Boolean)) add(h, spots, h.extras?.shots?.[team]?.[0]);
    }
    (h.extras?.seatSpots ?? []).forEach((list, seat) => {
      const spots = (list ?? []) as (Spot | null)[];
      if (spots.some(Boolean)) add(h, spots, seat);
    });
  }
  return drives;
}

/** A scorecard's posting payload (the shape golf_submit_round takes) as a round, for the live feed. */
export type PostedRound = {
  format?: string;
  courseId: number;
  playedOn: string;
  submittedBy?: string;
  settings?: SavedRound["settings"] & { format?: string };
  players: string[];
  teams?: Team[];
  holes: (Omit<SavedHole, "wolfSeat" | "partnerSeat" | "loneWolf" | "comment"> &
    Partial<Pick<SavedHole, "wolfSeat" | "partnerSeat" | "loneWolf">> & { comment?: string | null })[];
};
export function roundFromPayload(p: PostedRound, courseName = ""): SavedRound {
  const format = p.format === "points" || p.settings?.format === "points" ? "points" : "wolf";
  const holes: SavedHole[] = p.holes.map((h) => ({
    wolfSeat: null,
    partnerSeat: null,
    loneWolf: false,
    ...h,
    comment: h.comment?.trim() || null,
  }));
  const teamPoints =
    format === "points"
      ? holes.reduce(
          (t, h) => ({ black: t.black + (h.extras?.teamPoints?.black ?? 0), white: t.white + (h.extras?.teamPoints?.white ?? 0) }),
          { black: 0, white: 0 },
        )
      : null;
  return {
    id: "live",
    format,
    settings: p.settings ?? null,
    teamPoints,
    playedOn: p.playedOn,
    submittedBy: p.submittedBy ?? null,
    course: { id: p.courseId, name: courseName, city: null, state: null },
    players: p.players.map((name, seat) => ({
      seat,
      name: name.trim() || `Player ${seat + 1}`,
      team: p.teams?.[seat] ?? null,
      result: null,
      points: holes.reduce((sum, h) => sum + (h.points[seat] ?? 0), 0),
      strokes: holes.reduce((sum, h) => sum + (h.strokes[seat] ?? 0), 0),
    })),
    holes,
  };
}

/** `live`: the round is still being played, so the feed has no final result or MVP post yet. */
export function buildRecap(round: SavedRound, drives: Drive[] = [], { live = false } = {}): Recap {
  const isPoints = round.format === "points";
  const scramble = isPoints && Boolean(round.settings?.rules?.scramble);
  const holes = [...round.holes].sort((a, b) => a.number - b.number);
  const players: Line[] = [...round.players].sort((a, b) => a.seat - b.seat).map((p) => ({ seat: p.seat, name: p.name, team: p.team }));
  const nameOf = (seat: number | null | undefined) => players.find((p) => p.seat === seat)?.name ?? "";
  const lastHoles = new Set(holes.slice(-3).map((h) => h.number));
  const feed: FeedItem[] = [];
  const push = (item: FeedItem) => feed.push(item);

  const stats = new Map<number, Stat>(
    players.map((p) => [
      p.seat,
      { holes: 0, overPar: 0, birdies: 0, eagles: 0, aces: 0, blowups: 0, sand: 0, closest: 0, bestBalls: 0, bonus: 0, wolfPoints: 0, loneWins: 0, wolfWins: 0, bestStreak: 0, closing: null, clutch: 0, used: 0, tee: 0, holed: 0, fair: 0, longest: 0, moments: 0 },
    ]),
  );
  const st = (seat: number) => stats.get(seat)!;

  // Longest drive of the day (from GPS, measured by the recap page).
  const longest = [...drives].sort((a, b) => b.yds - a.yds)[0];
  if (longest && stats.has(longest.seat)) st(longest.seat).longest = longest.yds;

  // Captain's choice shots.
  if (scramble) {
    const teamSize = (t: Team | null) => players.filter((p) => p.team === t).length || 1;
    for (const s of roundShotStats(holes, players.map((p) => p.seat))) Object.assign(st(s.seat), { used: s.used, tee: s.tee, holed: s.holed });
    for (const h of holes)
      for (const p of players) {
        const list = p.team ? h.extras?.shots?.[p.team] : undefined;
        if (Array.isArray(list)) st(p.seat).fair += list.filter((x) => x !== null && x !== undefined).length / teamSize(p.team);
      }
  }

  let firstBirdie = true;
  const streak = new Map(players.map((p) => [p.seat, 0]));
  const lastBirdie = new Map<number, number>();
  let leader: string | null = null;
  const running = new Map(players.map((p) => [p.seat, 0]));
  const teamRun = { black: 0, white: 0 };
  let teamStreak: { team: Team | null; n: number } = { team: null, n: 0 };

  holes.forEach((h, idx) => {
    const ex = h.extras ?? {};
    const n = h.number;

    // Scores, birdies, blow-ups, streaks (individual balls only).
    if (!scramble) {
      for (const p of players) {
        const s = h.strokes[p.seat];
        if (!valid(s)) {
          streak.set(p.seat, 0);
          continue;
        }
        const me = st(p.seat);
        const diff = s - h.par;
        me.holes++;
        me.overPar += diff;
        if (lastHoles.has(n)) me.closing = (me.closing ?? 0) + diff;
        if (s === 1) {
          me.aces++;
          me.moments += 8;
          push({ hole: n, icon: "🕳️", title: "ACE!", text: `${p.name} makes a hole-in-one on #${n}. Drinks are on ${first(p.name)}.`, big: true });
        } else if (diff <= -2) {
          me.eagles++;
          me.moments += 5;
          push({ hole: n, icon: "🦅", title: diff <= -3 ? "Albatross" : "Eagle", text: `${p.name} cards a ${s} on the par-${h.par} #${n}.`, big: true });
        } else if (diff === -1) {
          me.birdies++;
          me.moments += 2;
          const again = lastBirdie.get(p.seat) === idx - 1;
          const tag = firstBirdie ? " First birdie of the day." : again ? " Back-to-back birdies!" : "";
          push({ hole: n, icon: "🐦", title: "Birdie", text: `${p.name} birdies #${n} (par ${h.par}).${tag}`, big: again });
          lastBirdie.set(p.seat, idx);
          firstBirdie = false;
        }
        if (diff <= -1 && lastHoles.has(n)) {
          me.clutch++;
          me.moments += 1;
        }
        if (diff >= 2) me.blowups++;
        if (diff >= 3)
          push({
            hole: n,
            icon: s === 8 ? "⛄" : "😬",
            title: s === 8 ? "Snowman" : "Rough hole",
            text: `${p.name} takes a ${s} on #${n}. Shake it off.`,
          });
        const run = diff <= 0 ? streak.get(p.seat)! + 1 : 0;
        streak.set(p.seat, run);
        me.bestStreak = Math.max(me.bestStreak, run);
        if (run === 4 || run === 7)
          push({ hole: n, icon: "🧊", title: "Ice cold", text: `${p.name} has ${run} straight pars or better through #${n}.` });
      }
    } else {
      // Captain's choice: team scores, and who carried the ball.
      for (const team of ["black", "white"] as Team[]) {
        const carrier = players.find((p) => p.team === team);
        if (!carrier) continue;
        const s = h.strokes[carrier.seat];
        if (!valid(s) || s >= h.par) continue;
        const who = (ex.shots?.[team] ?? []).filter((x): x is number => x !== null && x !== undefined);
        const drive = who.length > 1 ? who[0] : null;
        const putt = who.at(-1);
        const detail =
          drive !== null && putt !== undefined && drive !== putt
            ? ` Drive by ${first(nameOf(drive))}, holed by ${first(nameOf(putt))}.`
            : putt !== undefined && who.length && who.every((x) => x === putt)
              ? ` ${first(nameOf(putt))} hit every shot. One-man show!`
              : putt !== undefined
                ? ` Holed by ${first(nameOf(putt))}.`
                : "";
        const label = s === 1 ? "ACE" : s - h.par <= -2 ? "Eagle" : "Birdie";
        push({ hole: n, icon: label === "Birdie" ? "🐦" : "🦅", title: `${TEAM_NAMES[team]} ${label.toLowerCase()}`, text: `${TEAM_NAMES[team]} makes ${s} on the par-${h.par} #${n}.${detail}`, big: label !== "Birdie" });
        if (putt !== undefined && stats.has(putt)) st(putt).moments += s - h.par <= -2 ? 4 : 2;
        if (drive !== null && stats.has(drive) && drive !== putt) st(drive).moments += 1;
      }
    }

    // Dots extras.
    if (isPoints) {
      for (const seat of ex.sandSaves ?? []) {
        if (!stats.has(seat)) continue;
        st(seat).sand++;
        st(seat).moments += 1;
        push({ hole: n, icon: "🏖️", title: "Sand save", text: `${nameOf(seat)} gets up and down from the bunker on #${n}.` });
      }
      if (ex.closest !== null && ex.closest !== undefined && stats.has(ex.closest)) {
        st(ex.closest).closest++;
        st(ex.closest).moments += 1;
        push({ hole: n, icon: "🎯", title: "Closest to the pin", text: `${nameOf(ex.closest)} sticks it closest on #${n}.` });
      }
      // Captain's choice books the team's birdie dots on the captain's seat, so only sand saves
      // and closest count as a player's own dots there.
      if (!scramble) for (const p of players) st(p.seat).bonus += h.points[p.seat] ?? 0;
      if (!scramble) {
        for (const p of players) {
          const s = h.strokes[p.seat];
          if (!p.team || !valid(s) || ex.bestBall !== p.team) continue;
          const teamBest = Math.min(...players.filter((x) => x.team === p.team).map((x) => h.strokes[x.seat]).filter(valid));
          if (s === teamBest) st(p.seat).bestBalls++;
        }
      }
      // Team race: lead changes and winning streaks.
      const tp = ex.teamPoints ?? { black: 0, white: 0 };
      const before = teamRun.black === teamRun.white ? null : teamRun.black > teamRun.white ? "black" : "white";
      teamRun.black += tp.black;
      teamRun.white += tp.white;
      const after = teamRun.black === teamRun.white ? null : teamRun.black > teamRun.white ? "black" : "white";
      if (after && after !== before && idx > 0)
        push({ hole: n, icon: "📈", title: "Lead change", text: `${TEAM_NAMES[after]} takes the lead after #${n}, ${teamRun[after]}–${teamRun[after === "black" ? "white" : "black"]}.` });
      const won: Team | null = ex.bestBall ?? null;
      teamStreak = won && won === teamStreak.team ? { team: won, n: teamStreak.n + 1 } : { team: won, n: won ? 1 : 0 };
      if (won && (teamStreak.n === 3 || teamStreak.n === 5))
        push({ hole: n, icon: "🔥", title: "On a run", text: `${TEAM_NAMES[won]} wins best ball ${teamStreak.n} holes in a row (through #${n}).`, big: teamStreak.n === 5 });
    } else {
      // Wolf: lone wolf calls and the points race.
      const wolf = h.wolfSeat;
      const wolfWon = wolf !== null && (h.points[wolf] ?? 0) > 0;
      const othersWon = players.some((p) => p.seat !== wolf && p.seat !== h.partnerSeat && (h.points[p.seat] ?? 0) > 0);
      if (wolf !== null && stats.has(wolf) && wolfWon) st(wolf).wolfWins++;
      if (h.loneWolf && wolf !== null && stats.has(wolf)) {
        if (wolfWon) {
          st(wolf).loneWins++;
          st(wolf).moments += 3;
          push({ hole: n, icon: "🐺", title: "Lone Wolf pays off", text: `${nameOf(wolf)} goes it alone on #${n} and beats everyone. +${h.points[wolf]} points.`, big: true });
        } else if (othersWon) {
          push({ hole: n, icon: "🐺", title: "Lone Wolf bites back", text: `${nameOf(wolf)} goes alone on #${n} and loses it. Everyone else cashes in.` });
        } else {
          push({ hole: n, icon: "🐺", title: "Lone Wolf push", text: `${nameOf(wolf)} goes alone on #${n} and halves it.` });
        }
      } else if (
        wolf !== null &&
        h.partnerSeat !== null &&
        othersWon &&
        valid(h.strokes[h.partnerSeat]) &&
        h.strokes.every((x, seat) => seat === h.partnerSeat || !valid(x) || x < (h.strokes[h.partnerSeat!] as number))
      ) {
        push({ hole: n, icon: "🙈", title: "Bad pick", text: `${nameOf(wolf)} takes ${first(nameOf(h.partnerSeat))} on #${n}, who posts the worst score on the hole.` });
      }
      for (const p of players) running.set(p.seat, running.get(p.seat)! + (h.points[p.seat] ?? 0));
      const top = Math.max(...running.values());
      const tops = players.filter((p) => running.get(p.seat) === top);
      const now = top > 0 && tops.length === 1 ? tops[0].name : null;
      if (now && now !== leader && idx > 0)
        push({ hole: n, icon: "📈", title: "New leader", text: `${now} takes the lead after #${n} with ${plural(top, "point")}.` });
      if (now) leader = now;
    }

    if (longest && longest.hole === n && stats.has(longest.seat))
      push({ hole: n, icon: "💣", title: "Longest drive", text: `${nameOf(longest.seat)} bombs it ${longest.yds} yds on #${n}. Longest drive of the day.`, big: true });

    if (h.comment?.trim()) push({ hole: n, icon: "💬", title: "From the card", text: `“${h.comment.trim()}”` });

    // At the turn.
    if (idx === 8 && holes.length > 9) {
      if (isPoints) {
        const lead = teamRun.black === teamRun.white ? null : teamRun.black > teamRun.white ? "black" : "white";
        push({
          hole: n,
          icon: "📊",
          title: "At the turn",
          text: lead
            ? `${TEAM_NAMES[lead]} leads ${teamRun[lead]}–${teamRun[lead === "black" ? "white" : "black"]} after nine.`
            : `All square after nine, ${teamRun.black}–${teamRun.white}.`,
        });
      } else {
        const top = Math.max(...running.values());
        push({ hole: n, icon: "📊", title: "At the turn", text: `${joinNames(players.filter((p) => running.get(p.seat) === top).map((p) => p.name))} leads after nine with ${plural(top, "point")}.` });
      }
    }
  });

  for (const p of players) {
    const me = st(p.seat);
    if (scramble) me.bonus = me.sand + me.closest;
    if (me.longest) me.moments += 2;
    me.wolfPoints = round.players.find((x) => x.seat === p.seat)?.points ?? 0;
  }

  /* ---------- Grades ---------- */
  const seats = players.map((p) => p.seat);
  const get = (f: (s: Stat) => number | null) => seats.map((seat) => f(st(seat)));
  let parts: { key: string; weight: number; values: number[] }[];
  const teamDots = (seat: number) => {
    const t = players.find((p) => p.seat === seat)?.team;
    return t && round.teamPoints ? round.teamPoints[t] : null;
  };
  const shotsTracked = players.some((p) => st(p.seat).used > 0);
  if (scramble && shotsTracked) {
    parts = [
      { key: "share", weight: 0.35, values: curve(get((s) => (s.fair > 0 ? s.used / s.fair : null)), true, 0.6) },
      { key: "tee", weight: 0.15, values: curve(get((s) => s.tee), true, 4) },
      { key: "holed", weight: 0.1, values: curve(get((s) => s.holed), true, 3) },
      { key: "dots", weight: 0.15, values: curve(get((s) => s.bonus), true, 3) },
      { key: "team", weight: 0.1, values: curve(seats.map(teamDots), true, 4) },
      { key: "moments", weight: 0.15, values: curve(get((s) => s.moments), true, 4) },
    ];
  } else if (scramble) {
    // No shot-by-shot record: grade on the dots each player earned and the team result.
    parts = [
      { key: "team", weight: 0.5, values: curve(seats.map(teamDots), true, 4) },
      { key: "dots", weight: 0.3, values: curve(get((s) => s.bonus), true, 3) },
      { key: "moments", weight: 0.2, values: curve(get((s) => s.moments), true, 4) },
    ];
  } else {
    const perHole = (s: Stat) => (s.holes ? s.overPar / s.holes : null);
    parts = [
      { key: "scoring", weight: 0.4, values: curve(get(perHole), false, 0.5) },
      {
        key: "game",
        weight: 0.25,
        values: isPoints ? curve(get((s) => s.bonus + s.bestBalls), true, 4) : curve(get((s) => s.wolfPoints), true, 8),
      },
      { key: "moments", weight: 0.2, values: curve(get((s) => s.moments), true, 4) },
      { key: "consistency", weight: 0.15, values: curve(get((s) => (s.holes ? (s.blowups / s.holes) * 18 : null)), false, 3) },
    ];
  }

  const grades: Grade[] = players.map((p, i) => {
    const me = st(p.seat);
    const score = Math.round(100 * parts.reduce((sum, part) => sum + part.weight * part.values[i], 0));
    const facts: { v: number; good: string | null; bad: string | null }[] = parts.map((part) => {
      const v = part.values[i];
      switch (part.key) {
        case "scoring":
          return { v, good: me.holes ? `${toPar(me.overPar)} through ${me.holes}` : null, bad: me.holes ? `${toPar(me.overPar)} on the card` : null };
        case "game":
          return isPoints
            ? { v, good: me.bonus + me.bestBalls ? `${plural(me.bestBalls, "best ball")}, ${plural(me.bonus, "dot")}` : null, bad: "few dots for the team" }
            : { v, good: me.wolfPoints ? `${plural(me.wolfPoints, "Wolf point")}` : null, bad: `only ${plural(me.wolfPoints, "Wolf point")}` };
        case "moments": {
          const bits = [
            me.aces && plural(me.aces, "ace"),
            me.eagles && plural(me.eagles, "eagle"),
            me.birdies && plural(me.birdies, "birdie"),
            me.longest && `${me.longest}-yd drive`,
            me.loneWins && plural(me.loneWins, "Lone Wolf win"),
            me.sand && plural(me.sand, "sand save"),
            me.closest && `closest ×${me.closest}`,
          ].filter(Boolean) as string[];
          return { v, good: bits.length ? bits.slice(0, 2).join(", ") : null, bad: "no birdies" };
        }
        case "consistency":
          return { v, good: me.blowups === 0 && me.holes ? "no doubles" : null, bad: me.blowups ? `${plural(me.blowups, "double")} or worse` : null };
        case "share":
          return { v, good: me.used ? `${plural(me.used, "shot")} used` : null, bad: `${plural(me.used, "shot")} used` };
        case "tee":
          return { v, good: me.tee ? `${plural(me.tee, "tee shot")} used` : null, bad: "few tee shots used" };
        case "dots":
          return { v, good: me.bonus ? `${plural(me.bonus, "dot")} earned` : null, bad: me.bonus ? `only ${plural(me.bonus, "dot")}` : "no dots earned" };
        case "team": {
          const t = teamDots(p.seat);
          return { v, good: t !== null && p.team ? `${TEAM_NAMES[p.team]} ${plural(t, "dot")}` : null, bad: p.team ? `${TEAM_NAMES[p.team]} came up short` : null };
        }
        case "holed":
          return { v, good: me.holed ? `${plural(me.holed, "putt")} holed` : null, bad: "no putts holed" };
        default:
          return { v, good: null, bad: null };
      }
    });
    const strengths = [...facts].filter((f) => f.good && f.v >= 0.6).sort((a, b) => b.v - a.v).slice(0, 2).map((f) => f.good!);
    const weak = [...facts].filter((f) => f.bad && f.v < 0.5).sort((a, b) => a.v - b.v)[0]?.bad;
    const line = [...(strengths.length ? strengths : [facts.find((f) => f.good)?.good ?? "steady round"]), ...(weak ? [`work on: ${weak}`] : [])].join(" · ");
    return { seat: p.seat, name: p.name, score, ...markOf(score), line };
  });
  grades.sort((a, b) => b.score - a.score || st(b.seat).moments - st(a.seat).moments);

  /* ---------- MVP ---------- */
  let mvp: Recap["mvp"] = null;
  if (grades.length >= 2) {
    const top = grades[0];
    const me = st(top.seat);
    const why = scramble && !shotsTracked
      ? [me.bonus ? plural(me.bonus, "dot") + " earned" : null, me.closest ? `closest ×${me.closest}` : null, me.sand ? plural(me.sand, "sand save") : null].filter(Boolean).join(", ")
      : scramble
      ? `${plural(me.used, "shot")} used${me.tee ? `, ${plural(me.tee, "tee shot")}` : ""}${me.holed ? `, ${plural(me.holed, "putt")} holed` : ""}`
      : [me.holes ? `${toPar(me.overPar)} on the day` : null, me.birdies + me.eagles ? plural(me.birdies + me.eagles, "birdie") : null, !isPoints && me.wolfPoints ? `${plural(me.wolfPoints, "point")}` : null]
          .filter(Boolean)
          .join(", ");
    mvp = { ...top, why: why || top.line };
  }

  /* ---------- Side awards ---------- */
  const awards: Award[] = [];
  const award = (icon: string, title: string, value: (s: Stat) => number, min: number, detail: (v: number) => string, lowIsBest = false) => {
    const vals = players.map((p) => ({ p, v: value(st(p.seat)) })).filter((x) => Number.isFinite(x.v));
    if (!vals.length) return;
    const best = lowIsBest ? Math.min(...vals.map((x) => x.v)) : Math.max(...vals.map((x) => x.v));
    if (lowIsBest ? best > min : best < min) return;
    const who = vals.filter((x) => x.v === best).map((x) => x.p.name);
    if (who.length > 2 || (lowIsBest && who.length === vals.length)) return;
    awards.push({ icon, title, who: joinNames(who), detail: detail(best) });
  };
  if (longest && stats.has(longest.seat)) awards.push({ icon: "💣", title: "Big Stick", who: nameOf(longest.seat), detail: `${longest.yds} yds on #${longest.hole}` });
  if (scramble) {
    award("🧲", "Workhorse", (s) => s.used, 1, (v) => `${plural(v, "shot")} used`);
    award("🚀", "Tee Box King", (s) => s.tee, 2, (v) => `${plural(v, "drive")} used`);
    award("🕳️", "Closer", (s) => s.holed, 2, (v) => `${plural(v, "putt")} holed`);
  } else {
    award("🐦", "Birdie Machine", (s) => s.birdies + s.eagles + s.aces, 1, (v) => plural(v, "birdie"));
    award("🧊", "Ice Cold", (s) => s.bestStreak, 3, (v) => `${v} straight pars or better`);
    award("🧯", "Strong Finish", (s) => (s.closing === null ? NaN : s.closing), 1, (v) => `${toPar(v)} on the last 3 holes`, true);
  }
  if (!isPoints) award("🐺", "Alpha Wolf", (s) => s.wolfWins, 2, (v) => `won ${plural(v, "hole")} as the Wolf`);
  if (isPoints) {
    award("🏖️", "Sandman", (s) => s.sand, 1, (v) => plural(v, "sand save"));
    award("🎯", "Dart Thrower", (s) => s.closest, 2, (v) => `closest ${v} times`);
  }

  /* ---------- Final whistle ---------- */
  if (live) return { feed, grades, mvp, awards, note: null };
  const last = holes.at(-1)?.number ?? null;
  if (isPoints && round.teamPoints) {
    const { black, white } = round.teamPoints;
    push({
      hole: last,
      icon: "🏁",
      title: "Final",
      text: black === white ? `Black Belt and White Belt tie, ${black}–${white}.` : `${TEAM_NAMES[black > white ? "black" : "white"]} wins ${Math.max(black, white)}–${Math.min(black, white)}.`,
      big: true,
    });
  } else if (!isPoints) {
    const top = Math.max(...round.players.map((p) => p.points));
    push({ hole: last, icon: "🏁", title: "Final", text: `${joinNames(round.players.filter((p) => p.points === top).map((p) => p.name))} wins with ${plural(top, "point")}.`, big: true });
  }
  if (mvp) push({ hole: last, icon: "🏆", title: "MVP", text: `${mvp.name} (${mvp.mark}): ${mvp.why}.`, big: true });

  const note =
    scramble && !shotsTracked
      ? "Whose ball was used wasn't recorded this round, so grades lean on the team result, sand saves and closest to the pin. Tap the player on each shot next time for sharper grades."
      : null;
  return { feed, grades, mvp, awards, note };
}
