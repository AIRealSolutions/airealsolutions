// Who owes whom, from points and the bet price per point.
import type { Team } from "./points";

/** Wolf: every pair of players settles the difference in points. Net per player sums to zero. */
export function settleWolf(points: number[], betPerPoint: number) {
  const total = points.reduce((a, b) => a + b, 0);
  return points.map((p) => (points.length * p - total) * betPerPoint);
}

/**
 * Per-dot (team) bet: each player on the losing team pays the point difference times the bet;
 * the winning team splits what the losers pay. Ties pay nothing.
 */
export function settleTeams(teams: Team[], teamPoints: Record<Team, number>, betPerPoint: number) {
  const diff = Math.abs(teamPoints.black - teamPoints.white);
  if (!diff || !betPerPoint) return teams.map(() => 0);
  const winner: Team = teamPoints.black > teamPoints.white ? "black" : "white";
  const losers = teams.filter((t) => t !== winner).length;
  const winners = teams.length - losers;
  const pot = losers * diff * betPerPoint;
  return teams.map((t) => (t === winner ? pot / winners : -diff * betPerPoint));
}

export type Nassau = { front: number; back: number; total: number };
export type Segment = { key: keyof Nassau; label: string; black: number; white: number; winner: Team | null; amount: number };

/**
 * Dots front / back / total (e.g. 20/20/20). Each segment the losing team's players each pay
 * the segment amount and the winners split it. A tied segment, or one with no holes, pushes.
 * Optionally adds a per-dot bet on the overall difference (same split).
 */
export function settleDots(
  teams: Team[],
  holes: { number: number; teamPoints: Record<Team, number> }[],
  nassau: Nassau,
  betPerDot = 0,
) {
  const sum = (filter: (n: number) => boolean) =>
    holes
      .filter((h) => filter(h.number))
      .reduce((t, h) => ({ black: t.black + h.teamPoints.black, white: t.white + h.teamPoints.white, n: t.n + 1 }), {
        black: 0,
        white: 0,
        n: 0,
      });
  const parts: [keyof Nassau, string, (n: number) => boolean][] = [
    ["front", "Front", (n) => n <= 9],
    ["back", "Back", (n) => n >= 10],
    ["total", "Total", () => true],
  ];
  const perPlayer = teams.map(() => 0);
  const pay = (winner: Team, amount: number) => {
    const losers = teams.filter((t) => t !== winner).length;
    const winners = teams.length - losers;
    teams.forEach((t, i) => (perPlayer[i] += t === winner ? (losers * amount) / winners : -amount));
  };
  const segments: Segment[] = parts.map(([key, label, filter]) => {
    const s = sum(filter);
    const winner: Team | null = !s.n || s.black === s.white ? null : s.black > s.white ? "black" : "white";
    const amount = winner ? nassau[key] : 0;
    if (winner && amount) pay(winner, amount);
    return { key, label, black: s.black, white: s.white, winner, amount };
  });
  const total = segments[2];
  if (betPerDot && total.winner) pay(total.winner, Math.abs(total.black - total.white) * betPerDot);
  return { segments: segments.filter((s) => s.key === "total" || holes.some((h) => (s.key === "front" ? h.number <= 9 : h.number >= 10))), perPlayer };
}

export const money = (amount: number) => {
  const sign = amount < -0.004 ? "−" : amount > 0.004 ? "+" : "";
  return `${sign}$${Math.abs(amount).toFixed(2).replace(/\.00$/, "")}`;
};
