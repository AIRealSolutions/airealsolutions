"use client";
// A Site Spec form. Posts to /api/forms/<key>, which checks the fields against site.json and saves them.
import { useState, type FormEvent } from "react";
import type { SiteField, SiteForm as Form } from "@/lib/site-spec";

const inputType = (t: string) => ({ email: "email", phone: "tel", number: "number", money: "number", date: "date" })[t] || "text";

export default function SiteForm({ form, fields }: { form: Form; fields: SiteField[] }) {
  const [state, setState] = useState<"" | "sending" | "done">("");
  const [error, setError] = useState("");
  const [started] = useState(() => Date.now());

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const values: Record<string, string> = {};
    for (const f of fields) values[f.key] = String(fd.get(f.key) ?? "").trim();
    setState("sending");
    setError("");
    try {
      const r = await fetch(`/api/forms/${form.key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, website: String(fd.get("website") ?? ""), elapsed: Date.now() - started }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || "It could not be sent. Try again.");
      setState("done");
    } catch (err) {
      setState("");
      setError(err instanceof Error ? err.message : "It could not be sent. Try again.");
    }
  }

  if (state === "done") {
    return (
      <div className="done" role="status">
        <h3>{form.success_message}</h3>
        <button type="button" className="linkButton" onClick={() => setState("")}>
          Send another
        </button>
      </div>
    );
  }
  return (
    <form className="form" onSubmit={(e) => void submit(e)} aria-label={form.title || form.key}>
      {form.title && <h3>{form.title}</h3>}
      {fields.map((f) => (
        <label key={f.key}>
          <span>
            {f.label}
            {f.required && " *"}
          </span>
          {f.type === "textarea" ? (
            <textarea name={f.key} rows={4} required={f.required} maxLength={2000} />
          ) : f.type === "select" ? (
            <select name={f.key} required={f.required} defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {f.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input name={f.key} type={inputType(f.type)} required={f.required} maxLength={500} step={f.type === "money" ? "0.01" : undefined} />
          )}
        </label>
      ))}
      <label className="honeypot" aria-hidden="true">
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="button" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : form.submit_label}
      </button>
    </form>
  );
}
