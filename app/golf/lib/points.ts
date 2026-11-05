// Team Points scoring (Black Belt vs White Belt). Gross scores, no handicaps.
//   Best ball on the hole        -> 1 point to that team (tie: no point)
//   Birdie                        -> +1 for the player's team
//   Eagle or better               -> +1 more (2 total)
//   Sand save                     -> +1
//   Closest to the hole           -> +1 (one player per hole)
// Teams can change every round; each player's record (W-L-T) is kept by name.

export type Team = "black" | "white";
export const TEAMS: Team[] = ["black", "white"];
export const TEAM_NAMES: Record<Team, string> = { black: "Black Belt", white: "White Belt" };
export const POINTS_RULES = { bestBall: 1, birdie: 1, eagleBonus: 1, sandSave: 1, closest: 1 };

export type PointsHoleInput = {
  par: number;
  strokes: (number | null)[];
  teams: Team[];
  sandSaves: boolean[];
  closest: number | null;
};

export type PointsHoleOutcome = {
  points: number[]; // personal bonus points by seat
  bonuses: string[][]; // labels by seat, e.g. ["Birdie", "Sand save"]
  bestBall: Team | null;
  teamPoints: Record<Team, number>;
};

export const isPointsHoleComplete = (hole: PointsHoleInput) =>
  hole.strokes.every((s) => typeof s === "number" && s > 0);

export function scoreLabel(par: number, strokes: number) {
  const diff = strokes - par;
  if (strokes === 1) return "Ace";
  if (diff <= -3) return "Albatross";
  if (diff === -2) return "Eagle";
  if (diff === -1) return "Birdie";
  return null;
}

export function scorePointsHole(hole: PointsHoleInput, rules = POINTS_RULES): PointsHoleOutcome | null {
  if (!isPointsHoleComplete(hole)) return null;
  const strokes = hole.strokes as number[];
  const points = strokes.map(() => 0);
  const bonuses: string[][] = strokes.map(() => []);

  strokes.forEach((s, seat) => {
    const diff = s - hole.par;
    if (diff <= -1) {
      points[seat] += rules.birdie;
      bonuses[seat].push(diff <= -2 ? scoreLabel(hole.par, s)! : "Birdie");
    }
    if (diff <= -2) points[seat] += rules.eagleBonus;
    if (hole.sandSaves[seat]) {
      points[seat] += rules.sandSave;
      bonuses[seat].push("Sand save");
    }
    if (hole.closest === seat) {
      points[seat] += rules.closest;
      bonuses[seat].push("Closest");
    }
  });

  const best = (team: Team) => Math.min(...strokes.filter((_, seat) => hole.teams[seat] === team));
  const black = best("black");
  const white = best("white");
  const bestBall: Team | null = black < white ? "black" : white < black ? "white" : null;

  const teamPoints: Record<Team, number> = { black: 0, white: 0 };
  points.forEach((p, seat) => (teamPoints[hole.teams[seat]] += p));
  if (bestBall) teamPoints[bestBall] += rules.bestBall;
  return { points, bonuses, bestBall, teamPoints };
}

export function pointsTotals(holes: PointsHoleInput[], playerCount: number) {
  const team: Record<Team, number> = { black: 0, white: 0 };
  const player = Array(playerCount).fill(0);
  holes.forEach((hole) => {
    const outcome = scorePointsHole(hole);
    if (!outcome) return;
    team.black += outcome.teamPoints.black;
    team.white += outcome.teamPoints.white;
    outcome.points.forEach((p, i) => (player[i] += p));
  });
  return { team, player };
}
