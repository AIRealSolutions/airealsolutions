// Server-side: a season's rounds with their recaps (feed, grades, MVP), and the MVP race.
import { golfRead, type Course, type SavedRound } from "./api";
import type { Spot } from "./geo";
import { getPin } from "./pin";
import { buildRecap, roundDrives, type Letter, type Recap } from "./recap";
import { keyOf } from "./skill";

export type RoundRecap = { round: SavedRound; recap: Recap };

/** Rounds newest first (year null = any year), each with its recap. */
export async function seasonRecaps(year: number | null, limit = 50): Promise<RoundRecap[]> {
  const pin = await getPin();
  const [rounds, courses] = await Promise.all([
    golfRead<SavedRound[]>("golf_season_rounds", { p_year: year, p_limit: limit, p_pin: pin }, [], 60),
    golfRead<Course[]>("golf_courses", { p_pin: pin }, [], 300),
  ]);
  return rounds
    .filter((r) => r?.players?.length && r.holes?.length)
    .map((round) => {
      const holes = courses.find((c) => c.id === round.course.id)?.holes ?? [];
      const greenOf = (n: number) => (holes.find((h) => h.number === n)?.green ?? null) as Spot | null;
      return { round, recap: buildRecap(round, roundDrives(round.holes, greenOf)) };
    });
}

export type MvpRow = {
  name: string;
  rounds: number;
  mvps: number;
  avgScore: number;
  letters: Record<Letter, number>;
  best: string; // best mark this season
};

const LETTER_RANK = { A: 4, B: 3, C: 2, D: 1 } as const;
const markRank = (mark: string) => LETTER_RANK[mark[0] as Letter] * 3 + (mark.endsWith("+") ? 1 : mark.endsWith("–") ? -1 : 0);

/** MVP awards and average round grade per player (names matched case-insensitively). */
export function mvpRace(items: RoundRecap[]): MvpRow[] {
  const rows = new Map<string, MvpRow & { total: number }>();
  for (const { recap } of items) {
    for (const g of recap.grades) {
      const k = keyOf(g.name);
      const row =
        rows.get(k) ?? { name: g.name, rounds: 0, mvps: 0, avgScore: 0, total: 0, letters: { A: 0, B: 0, C: 0, D: 0 }, best: g.mark };
      row.rounds++;
      row.total += g.score;
      row.letters[g.letter]++;
      if (markRank(g.mark) > markRank(row.best)) row.best = g.mark;
      if (recap.mvp && recap.mvp.seat === g.seat) row.mvps++;
      rows.set(k, row);
    }
  }
  return [...rows.values()]
    .map(({ total, ...r }) => ({ ...r, avgScore: Math.round(total / r.rounds) }))
    .sort((a, b) => b.mvps - a.mvps || b.avgScore - a.avgScore || b.rounds - a.rounds);
}
