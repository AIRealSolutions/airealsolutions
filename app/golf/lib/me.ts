// Server-only helpers for player sign-in (/golf/me). The session token lives in an httpOnly cookie
// set by /golf/me/login; the database only stores its hash (see docs/golfbuddy-player-login.sql).
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { golfRpc, type Tees } from "./api";

export const PLAYER_COOKIE = "golf_player";
export const ME_MESSAGE_COOKIE = "golf_me_msg";

export type Me = {
  id: number;
  name: string;
  nickname: string | null;
  tees: Tees | null;
  email: string | null;
  phone: string | null;
  handicap: number | null;
  hasPin: boolean;
};

export async function getPlayerToken() {
  return (await cookies()).get(PLAYER_COOKIE)?.value ?? "";
}

/** The signed-in player, or null (signed out, or the sign-in functions are not installed yet). */
export async function getMe(): Promise<Me | null> {
  const token = await getPlayerToken();
  if (!token) return null;
  try {
    const me = await golfRpc<Me & { error?: string }>("golf_me", { p_token: token });
    return me && !me.error && me.id ? me : null;
  } catch {
    return null;
  }
}

/** One-time message for the /golf/me page ("Saved.", or an error), read and shown once. */
export async function getMeMessage() {
  const raw = (await cookies()).get(ME_MESSAGE_COOKIE)?.value ?? "";
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { text: string; error?: boolean };
  } catch {
    return null;
  }
}

const base = (url: URL) => ({ httpOnly: true, secure: url.protocol === "https:", sameSite: "lax" as const, path: "/golf" });

export function setMessage(res: NextResponse, url: URL, text: string, error = false) {
  res.cookies.set(ME_MESSAGE_COOKIE, JSON.stringify({ text, error }), { ...base(url), maxAge: 20 });
}

export function setSession(res: NextResponse, url: URL, token: string) {
  res.cookies.set(PLAYER_COOKIE, token, { ...base(url), maxAge: 60 * 60 * 24 * 180 });
}

export function clearSession(res: NextResponse) {
  res.cookies.delete({ name: PLAYER_COOKIE, path: "/golf" });
}
