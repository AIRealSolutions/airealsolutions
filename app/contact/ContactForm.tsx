"use client";

import { useEffect, useState } from "react";

/** Project inquiry form. Leads go straight into the Office CRM (/api/office/leads). */
export default function ContactForm() {
  const [started, setStarted] = useState(0);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  useEffect(() => setStarted(Date.now()), []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    try {
      const r = await fetch("/api/office/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, started_at: started, business: "ai-real-solutions", source: "airealsolutions.com/contact" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Something went wrong.");
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="contact-form-done" role="status">
        <h3>Thank you. We have your note.</h3>
        <p>We usually reply within one business day.</p>
      </div>
    );
  }

  return (
    <form className="contact-form" onSubmit={submit}>
      <label>Your name<input name="name" required maxLength={120} autoComplete="name" /></label>
      <label>Email<input name="email" type="email" required maxLength={200} autoComplete="email" /></label>
      <label>Organization (optional)<input name="company" maxLength={160} autoComplete="organization" /></label>
      <label>Phone (optional)<input name="phone" type="tel" maxLength={40} autoComplete="tel" /></label>
      <label>What should work better?<textarea name="message" rows={5} maxLength={4000} placeholder="A rough description is fine." /></label>
      {/* Hidden from people; bots fill it in. */}
      <label className="contact-form-hp" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      {error && <p className="contact-form-error" role="alert">{error}</p>}
      <button className="button button-primary" type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send"}</button>
    </form>
  );
}
