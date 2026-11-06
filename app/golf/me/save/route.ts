import { NextResponse } from "next/server";
import { golfRpc } from "../../lib/api";
import { clearSession, getPlayerToken, setMessage } from "../../lib/me";

/** Profile form target: saves the signed-in player's own details (and a new PIN when given). */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const form = await request.formData();
  const field = (k: string, max: number) => String(form.get(k) ?? "").trim().slice(0, max);
  const response = NextResponse.redirect(new URL("/golf/me", url), 303);
  const newPin = field("newPin", 8).replace(/\D/g, "");
  if (newPin && newPin !== field("confirmPin", 8).replace(/\D/g, "")) {
    setMessage(response, url, "The two PINs don't match.", true);
    return response;
  }
  try {
    const result = await golfRpc<{ error?: string; name?: string }>("golf_me_update", {
      p_token: await getPlayerToken(),
      p: {
        name: field("name", 40),
        nickname: field("nickname", 40),
        tees: field("tees", 5),
        email: field("email", 120),
        phone: field("phone", 30),
        newPin,
      },
    });
    if (result?.error === "signed_out") {
      clearSession(response);
      setMessage(response, url, "You were signed out. Sign in again.", true);
    } else if (result?.error) {
      setMessage(response, url, result.error, true);
    } else {
      setMessage(response, url, newPin ? "Saved. Use your new PIN next time." : "Saved.");
    }
  } catch {
    setMessage(response, url, "Could not save right now. Try again in a minute.", true);
  }
  return response;
}
