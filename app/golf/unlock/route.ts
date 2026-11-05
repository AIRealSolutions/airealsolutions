import { NextResponse } from "next/server";
import { checkPin, PIN_COOKIE, PIN_ERROR_COOKIE } from "../lib/pin";

/** PIN form target: checks the group (or admin) PIN, remembers it on this device, and goes back. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const form = await request.formData();
  const pin = String(form.get("pin") ?? "").replace(/\D/g, "").slice(0, 8);

  // Go back to the golf page the visitor was on (same site only).
  let back = "/golf";
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const r = new URL(referer);
      if (r.host === url.host && r.pathname.startsWith("/golf") && !r.pathname.startsWith("/golf/unlock")) {
        back = r.pathname + r.search;
      }
    } catch {}
  }

  const response = NextResponse.redirect(new URL(back, url), 303);
  const secure = url.protocol === "https:";
  const result = await checkPin(pin);
  if (result.role) {
    response.cookies.set(PIN_COOKIE, pin, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/golf",
      maxAge: 60 * 60 * 24 * 365,
    });
    response.cookies.delete({ name: PIN_ERROR_COOKIE, path: "/golf" });
  } else {
    response.cookies.set(PIN_ERROR_COOKIE, result.error || "Enter the group PIN.", {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/golf",
      maxAge: 15,
    });
  }
  return response;
}
