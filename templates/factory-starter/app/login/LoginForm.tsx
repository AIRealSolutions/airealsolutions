"use client";
import { useState, type FormEvent } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function LoginForm({ next }: { next: string }) {
  const [state, setState] = useState<"" | "sending" | "sent">("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") || "").trim();
    const sb = supabaseBrowser();
    if (!sb) return setError("Sign-in is not connected yet.");
    setState("sending");
    setError("");
    const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
    if (error) {
      setState("");
      setError(error.message);
    } else setState("sent");
  }

  if (state === "sent") return <div className="done" role="status"><h3>Check your email for the sign-in link.</h3></div>;
  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <label>
        <span>Email</span>
        <input name="email" type="email" required autoComplete="email" />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="button" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Email me a link"}</button>
    </form>
  );
}
