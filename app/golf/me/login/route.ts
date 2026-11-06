import { NextResponse } from "next/server";
import { golfRpc } from "../../lib/api";
import { setMessage, setSession } from "../../lib/me";

/** Sign-in form target: name + PIN (or the one-time sign-in code from the organizer). */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim().slice(0, 40);
  const secret = String(form.get("secret") ?? "").replace(/\D/g, "").slice(0, 8);
  const response = NextResponse.redirect(new URL("/golf/me", url), 303);
  if (!name || !secret) {
    setMessage(response, url, "Enter your name and your PIN or sign-in code.", true);
    return response;
  }
  try {
    const result = await golfRpc<{ token?: string; error?: string; mustSetPin?: boolean }>("golf_player_login", {
      p_name: name,
      p_secret: secret,
    });
    if (result?.token) {
      setSession(response, url, result.token);
      setMessage(response, url, result.mustSetPin ? "You're in. Choose your own PIN below and save." : "Signed in.");
    } else {
      setMessage(response, url, result?.error || "Could not sign in.", true);
    }
  } catch {
    setMessage(response, url, "Sign-in is not available right now. Try again in a minute.", true);
  }
  return response;
}
