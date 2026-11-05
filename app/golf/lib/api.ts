// Golf Buddy data access. Everything goes through SECURITY DEFINER RPCs in the
// shared Supabase project (see docs/golfbuddy-database.sql), so only the
// browser-safe publishable key is ever used here.
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
  wolfSeat: number;
  partnerSeat: number | null;
  loneWolf: boolean;
  strokes: number[];
  points: number[];
  comment: string | null;
};
export type SavedRound = {
  id: string;
  playedOn: string;
  submittedBy: string | null;
  course: { id: number; name: string; city: string | null; state: string | null };
  players: { seat: number; name: string; points: number; strokes: number }[];
  holes: SavedHole[];
};
export type RecentRound = { id: string; playedOn: string; course: string; winner: string | null; players: string };
export type LeaderRow = { name: string; rounds: number; points: number; wins: number; avgStrokes: number };

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
