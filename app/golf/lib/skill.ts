// Skill ratings and fair team pairing.
//
// A player's "pairing number" reads like a handicap: lower is better.
//   1. Start from the handicap in the control panel's player list, when set.
//   2. Otherwise (or blended in as rounds pile up) use their own scores: average strokes over par
//      per hole x 18, from Wolf and regular Dots rounds.
//   3. Adjust by captain's choice shots: a player whose shots the team uses more than a fair share
//      (1 / team size) moves down (better), less moves up. Worth up to 6 strokes, scaled by how many
//      shots have been recorded.
// Players with no history get the group average, marked provisional.
import type { Team } from "./points";

export type PlayerStat = {
  name: string;
  rounds: number;
  holes: number;
  overPar: number;
  bestBalls: number;
  shotsUsed: number;
  shotsExpected: number;
  teamShots: number;
  teeShots: number;
  holedShots: number;
  drives?: number; // GPS-measured drives (captain's choice, par 4s and 5s)
  avgDrive?: number | null;
  longestDrive?: number | null;
  handicap: number | string | null;
};

export type Tier = "A" | "B" | "C" | "D";
export type Skill = {
  name: string;
  rating: number; // pairing number, lower is better
  tier: Tier;
  provisional: boolean;
  shareIndex: number | null; // shots used / fair share (1.0 = fair share)
  basis: string;
};

export const TIER_LABEL: Record<Tier, string> = { A: "A · 0–9", B: "B · 10–17", C: "C · 18–25", D: "D · 26+" };
const DEFAULT_RATING = 18;
const MIN_HOLES = 9;
const MIN_EXPECTED_SHOTS = 4;
const SHOT_WEIGHT = 6;

export const keyOf = (name: string) => name.trim().toLowerCase();
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

export function tierOf(rating: number): Tier {
  if (rating < 9.5) return "A";
  if (rating < 17.5) return "B";
  if (rating < 25.5) return "C";
  return "D";
}

/** Share of the team's captain's choice shots that were this player's, vs. a fair share. */
export function shareIndex(stat: Pick<PlayerStat, "shotsUsed" | "shotsExpected">) {
  const expected = Number(stat.shotsExpected);
  return expected >= MIN_EXPECTED_SHOTS ? stat.shotsUsed / expected : null;
}

function baseRating(stat: PlayerStat): { value: number | null; basis: string[] } {
  const hcp = stat.handicap === null || stat.handicap === "" ? null : Number(stat.handicap);
  const scored = stat.holes >= MIN_HOLES ? (stat.overPar / stat.holes) * 18 : null;
  if (hcp !== null && Number.isFinite(hcp)) {
    if (scored === null) return { value: hcp, basis: ["handicap"] };
    // Lean on real scores more as they pile up, up to half the weight after 5 rounds of holes.
    const w = Math.min(stat.holes / 90, 0.5);
    return { value: hcp * (1 - w) + scored * w, basis: ["handicap", `${stat.holes} holes scored`] };
  }
  if (scored !== null) return { value: scored, basis: [`${stat.holes} holes scored`] };
  return { value: null, basis: [] };
}

/** Skill for every player with stats. Names are matched case-insensitively. */
export function buildSkills(stats: PlayerStat[]): Map<string, Skill> {
  const bases = stats.map((s) => ({ stat: s, ...baseRating(s) }));
  const known = bases.filter((b) => b.value !== null).map((b) => b.value!);
  const groupAvg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : DEFAULT_RATING;
  const skills = new Map<string, Skill>();
  for (const { stat, value, basis } of bases) {
    const idx = shareIndex(stat);
    const confidence = Math.min(1, Number(stat.shotsExpected) / 20);
    const adjust = idx === null ? 0 : -clamp(idx - 1, -1, 1) * SHOT_WEIGHT * confidence;
    const parts = [...basis];
    if (idx !== null) parts.push(`${stat.shotsUsed} shots used`);
    const rating = round1(clamp((value ?? groupAvg) + adjust, 0, 40));
    skills.set(keyOf(stat.name), {
      name: stat.name,
      rating,
      tier: tierOf(rating),
      provisional: value === null && idx === null,
      shareIndex: idx === null ? null : round1(idx * 10) / 10,
      basis: parts.length ? parts.join(" · ") : "no history yet",
    });
  }
  return skills;
}

/** Rating for a name, falling back to the group average for someone new. */
export function ratingFor(skills: Map<string, Skill>, name: string) {
  const hit = skills.get(keyOf(name));
  if (hit) return hit.rating;
  const all = [...skills.values()].filter((s) => !s.provisional).map((s) => s.rating);
  return all.length ? round1(all.reduce((a, b) => a + b, 0) / all.length) : DEFAULT_RATING;
}

const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Average pairing number for each team. */
export function teamStrength(ratings: number[], teams: Team[]) {
  const pick = (t: Team) => ratings.filter((_, i) => teams[i] === t);
  return { black: round1(average(pick("black"))), white: round1(average(pick("white"))) };
}

/**
 * Splits players into two teams as evenly as possible (team sizes differ by at most one) so the
 * average pairing numbers are closest. Picks at random among splits within `slack` strokes of the
 * best, so the same group does not always get the same teams.
 */
export function balanceTeams(ratings: number[], slack = 0.75, random = Math.random): Team[] {
  const n = ratings.length;
  if (n < 2) return ratings.map(() => "black");
  const options: { teams: Team[]; gap: number }[] = [];
  for (let mask = 1; mask < (1 << n) - 1; mask++) {
    let size = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) size++;
    if (Math.abs(n - 2 * size) > 1) continue;
    const teams = ratings.map((_, i) => (mask & (1 << i) ? "black" : "white") as Team);
    const s = teamStrength(ratings, teams);
    options.push({ teams, gap: Math.abs(s.black - s.white) });
  }
  const best = Math.min(...options.map((o) => o.gap));
  const close = options.filter((o) => o.gap <= best + slack + 1e-9);
  return close[Math.floor(random() * close.length)].teams;
}

/* ---------- Captain's choice shots ---------- */

export type ShotLog = Partial<Record<Team, (number | null)[]>>;

/** Labels a shot by position: tee shot first, the last one went in. */
export function shotLabel(index: number, count: number, par: number) {
  if (index === count - 1) return count === 1 ? "Ace" : "Holed";
  if (index === 0) return par === 3 ? "Tee shot" : "Drive";
  return `Shot ${index + 1}`;
}

export type RoundShotStat = { seat: number; used: number; tee: number; holed: number };

/** Shots used per seat in a round, from each hole's extras.shots. */
export function roundShotStats(holes: { extras?: { shots?: ShotLog } }[], seats: number[]): RoundShotStat[] {
  const stats = new Map(seats.map((seat) => [seat, { seat, used: 0, tee: 0, holed: 0 }]));
  for (const h of holes) {
    for (const list of Object.values(h.extras?.shots ?? {})) {
      if (!Array.isArray(list)) continue;
      list.forEach((seat, k) => {
        const s = seat === null || seat === undefined ? undefined : stats.get(seat);
        if (!s) return;
        s.used++;
        if (k === 0) s.tee++;
        if (k === list.length - 1) s.holed++;
      });
    }
  }
  return [...stats.values()];
}
