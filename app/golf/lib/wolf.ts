// Wolf scoring. Pure functions so the scorecard and the recap agree.
//
// Each hole one player is the Wolf (rotates by tee order). After the tee shots the
// Wolf picks a partner or goes Lone Wolf. Best ball (lowest gross score) per side.
//   Wolf + partner win  -> each gets `teamWin`
//   Other side wins     -> each gets `opponentsWin`
//   Lone Wolf wins      -> Wolf gets `loneWin`
//   Lone Wolf loses     -> each opponent gets `loneLoss`
//   Tie                 -> no points

export const DEFAULT_RULES = { teamWin: 2, opponentsWin: 3, loneWin: 4, loneLoss: 1 };
export type WolfRules = typeof DEFAULT_RULES;

export const wolfSeatFor = (holeIndex: number, playerCount: number) => holeIndex % playerCount;

export type HoleInput = {
  strokes: (number | null)[];
  wolfSeat: number;
  partnerSeat: number | null;
  loneWolf: boolean;
};

export type HoleOutcome = { points: number[]; winner: "wolf" | "opponents" | "push" };

const hasScore = (s: number | null | undefined): s is number => typeof s === "number" && s > 0;

export const sides = (hole: HoleInput) => {
  const wolfSide = hole.loneWolf ? [hole.wolfSeat] : hole.partnerSeat === null ? [hole.wolfSeat] : [hole.wolfSeat, hole.partnerSeat];
  const others = hole.strokes.map((_, seat) => seat).filter((seat) => !wolfSide.includes(seat));
  return { wolfSide, others };
};

/** Counts once the partner is picked and each side has at least one score (others can pick up). */
export function isHoleComplete(hole: HoleInput) {
  if (!(hole.loneWolf || hole.partnerSeat !== null)) return false;
  const { wolfSide, others } = sides(hole);
  return wolfSide.some((s) => hasScore(hole.strokes[s])) && others.some((s) => hasScore(hole.strokes[s]));
}

export function scoreHole(hole: HoleInput, rules: WolfRules = DEFAULT_RULES): HoleOutcome | null {
  if (!isHoleComplete(hole)) return null;
  const strokes = hole.strokes;
  const wolfSide = hole.loneWolf ? [hole.wolfSeat] : [hole.wolfSeat, hole.partnerSeat as number];
  const others = strokes.map((_, seat) => seat).filter((seat) => !wolfSide.includes(seat));
  const best = (seats: number[]) => Math.min(...seats.map((s) => strokes[s]).filter(hasScore));
  const wolfBest = best(wolfSide);
  const otherBest = best(others);
  const points = strokes.map(() => 0);

  if (wolfBest === otherBest) return { points, winner: "push" };
  if (wolfBest < otherBest) {
    if (hole.loneWolf) points[hole.wolfSeat] = rules.loneWin;
    else wolfSide.forEach((s) => (points[s] = rules.teamWin));
    return { points, winner: "wolf" };
  }
  others.forEach((s) => (points[s] = hole.loneWolf ? rules.loneLoss : rules.opponentsWin));
  return { points, winner: "opponents" };
}

export function totals(holes: HoleInput[], playerCount: number, rules: WolfRules = DEFAULT_RULES) {
  const points = Array(playerCount).fill(0);
  const strokes = Array(playerCount).fill(0);
  holes.forEach((hole) => {
    const outcome = scoreHole(hole, rules);
    if (!outcome) return;
    outcome.points.forEach((p, i) => (points[i] += p));
    hole.strokes.forEach((s, i) => (strokes[i] += s ?? 0));
  });
  return { points, strokes };
}
