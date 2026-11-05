// Golf Buddy data access. Everything goes through SECURITY DEFINER RPCs in the
// shared Supabase project (see docs/golfbuddy-database.sql), so only the
// browser-safe publishable key is ever used here.
/** Public address used for shared links. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://airealsolutions.com").replace(/\/$/, "");
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xqdsmbyealtammgmpsqe.supabase.co";
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_78q5LVudkA7u2hqsecLmAw_br2XlkUB";

export type Hole = {
  number: number;
  par: number;
  handicap: number | null;
  yardsWhite: number | null;
  yardsBlue: number | null;
  yardsBlack: number | null;
};
export type Course = { id: number; name: string; city: string | null; state: string | null; par: number | null; holes: Hole[] };

export type SavedHole = {
  number: number;
  par: number;
  wolfSeat: number | null;
  partnerSeat: number | null;
  loneWolf: boolean;
  strokes: (number | null)[];
  points: number[];
  comment: string | null;
  extras?: { sandSaves?: number[]; closest?: number | null; bestBall?: "black" | "white" | null; teamPoints?: { black: number; white: number } };
};
export type SavedRound = {
  id: string;
  format: "wolf" | "points";
  settings?: { betPerPoint?: number | string; rules?: Record<string, number> } | null;
  teamPoints: { black: number; white: number } | null;
  playedOn: string;
  submittedBy: string | null;
  course: { id: number; name: string; city: string | null; state: string | null };
  players: { seat: number; name: string; team: "black" | "white" | null; result: "win" | "loss" | "tie" | null; points: number; strokes: number }[];
  holes: SavedHole[];
};
export type RecentRound = { id: string; format: "wolf" | "points"; playedOn: string; course: string; winner: string | null; players: string };
export type LeaderRow = { name: string; rounds: number; points: number; wins: number; losses: number; ties: number; avgStrokes: number };
export type TeamRecord = { rounds: number; blackWins: number; whiteWins: number; ties: number; blackPoints: number; whitePoints: number };

export async function golfRpc<T>(fn: string, args: Record<string, unknown> = {}, revalidate?: number): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    ...(revalidate === undefined ? { cache: "no-store" as const } : { next: { revalidate } }),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
    } catch {}
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

/** Server-side read that never throws: returns the fallback when the data service is unavailable. */
export async function golfRead<T>(fn: string, args: Record<string, unknown>, fallback: T, revalidate = 30): Promise<T> {
  try {
    return (await golfRpc<T>(fn, args, revalidate)) ?? fallback;
  } catch (error) {
    console.error(`Golf Buddy: ${fn} unavailable`, error);
    return fallback;
  }
}

export const formatDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/* ---------- Settings (bet price, games, rule values) ---------- */
// nassauFront/Back/Total are the Dots front/back/total bet in dollars (stored with the rules so each round keeps them).
export type PointsRulesSetting = {
  bestBall: number;
  birdie: number;
  eagleBonus: number;
  sandSave: number;
  closest: number;
  nassauFront: number;
  nassauBack: number;
  nassauTotal: number;
};
export type WolfRulesSetting = { teamWin: number; opponentsWin: number; loneWin: number; loneLoss: number };
export type GolfSettings = {
  betPerPoint: number;
  defaultGame: "points" | "wolf";
  pinRequired: boolean;
  games: {
    points: { enabled: boolean; rules: PointsRulesSetting };
    wolf: { enabled: boolean; rules: WolfRulesSetting };
  };
};
export const DEFAULT_SETTINGS: GolfSettings = {
  betPerPoint: 0,
  defaultGame: "points",
  pinRequired: false,
  games: {
    points: {
      enabled: true,
      rules: { bestBall: 1, birdie: 1, eagleBonus: 1, sandSave: 1, closest: 1, nassauFront: 0, nassauBack: 0, nassauTotal: 0 },
    },
    wolf: { enabled: true, rules: { teamWin: 2, opponentsWin: 3, loneWin: 4, loneLoss: 1 } },
  },
};

/** Normalizes settings from the server over the defaults (works before the admin migration is applied). */
export function normalizeSettings(s: Partial<GolfSettings> | null | undefined): GolfSettings {
  if (!s) return DEFAULT_SETTINGS;
  const d = DEFAULT_SETTINGS.games;
  return {
    betPerPoint: Number(s.betPerPoint ?? 0),
    defaultGame: s.defaultGame === "wolf" ? "wolf" : "points",
    pinRequired: Boolean(s.pinRequired),
    games: {
      points: { enabled: s.games?.points?.enabled ?? true, rules: { ...d.points.rules, ...s.games?.points?.rules } },
      wolf: { enabled: s.games?.wolf?.enabled ?? true, rules: { ...d.wolf.rules, ...s.games?.wolf?.rules } },
    },
  };
}

export async function getSettings(): Promise<GolfSettings> {
  return normalizeSettings(await golfRead<Partial<GolfSettings> | null>("golf_settings", {}, null, 30));
}

export const getRoster = (pin = "") => golfRead<string[]>("golf_roster", { p_pin: pin }, [], 60);

export const PIN_STORAGE_KEY = "golfbuddy.pin.v1";

/** Posts a round. Returns the new round id, or throws (error.pin = true for a PIN problem). */
export async function submitRound(payload: Record<string, unknown>): Promise<string> {
  const result = await golfRpc<string | { id?: string; error?: string; pin?: boolean }>("golf_submit_round", { p: payload });
  if (typeof result === "string") return result; // older server version
  if (result?.id) return result.id;
  const error = new Error(result?.error || "Could not post the round.") as Error & { pin?: boolean };
  error.pin = Boolean(result?.pin);
  throw error;
}
