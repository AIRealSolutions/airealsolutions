import { NextResponse } from "next/server";
import { golfRpc } from "../../lib/api";
import { clearSession, getPlayerToken, setMessage } from "../../lib/me";

/** Signs this device out (and ends the session on the server). */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const response = NextResponse.redirect(new URL("/golf/me", url), 303);
  try {
    await golfRpc("golf_player_logout", { p_token: await getPlayerToken() });
  } catch {}
  clearSession(response);
  setMessage(response, url, "Signed out on this device.");
  return response;
}
