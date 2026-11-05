// Who owes whom, from points and the bet price per point.
import type { Team } from "./points";

/** Wolf: every pair of players settles the difference in points. Net per player sums to zero. */
export function settleWolf(points: number[], betPerPoint: number) {
  const total = points.reduce((a, b) => a + b, 0);
  return points.map((p) => (points.length * p - total) * betPerPoint);
}

/**
 * Team Points: each player on the losing team pays the point difference times the bet;
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

export const money = (amount: number) => {
  const sign = amount < -0.004 ? "−" : amount > 0.004 ? "+" : "";
  return `${sign}$${Math.abs(amount).toFixed(2).replace(/\.00$/, "")}`;
};
