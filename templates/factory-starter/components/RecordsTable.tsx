// Members-only list of an entity's submissions. Visitors get a sign-in prompt; RLS enforces it in the database too.
import Link from "next/link";
import { demoMode, site } from "@/lib/site";
import type { SiteEntity } from "@/lib/site-spec";
import { hasSupabase } from "@/lib/supabase/env";
import { currentUser, isMember, supabaseServer } from "@/lib/supabase/server";
import { setStatus } from "@/app/actions";

type Row = { id: string; data: Record<string, string>; status: string; created_at: string };
const STATUSES = ["new", "contacted", "done", "archived"];

export default async function RecordsTable({ entity }: { entity: SiteEntity }) {
  const cols = entity.fields.slice(0, 6);
  const demo = demoMode ? (site.demo_data.find((d) => d.entity === entity.key)?.rows ?? []) : [];
  let rows: Row[] = [];
  let note = "";

  if (!hasSupabase()) {
    note = "The database is not connected yet, so only demo rows can show here.";
  } else if (!(await currentUser())) {
    return (
      <div className="tableWrap">
        <p>
          This list is for staff. <Link href="/login">Sign in</Link> to see it.
        </p>
      </div>
    );
  } else if (!(await isMember())) {
    note = "Your account is not on the staff list for this site. Ask the owner to add your email.";
  } else {
    const sb = (await supabaseServer())!;
    const { data, error } = await sb
      .from("site_submissions")
      .select("id,data,status,created_at")
      .eq("entity_key", entity.key)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) note = "Records could not be loaded. Try again.";
    rows = (data as Row[] | null) ?? [];
  }

  return (
    <div className="tableWrap">
      {note && <p className="note">{note}</p>}
      <table className="table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
            <th>Received</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {cols.map((c) => (
                <td key={c.key} data-label={c.label}>{r.data[c.key] || "—"}</td>
              ))}
              <td data-label="Received">
                <span>{new Date(r.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </td>
              <td data-label="Status">
                <form action={setStatus} className="statusForm">
                  <input type="hidden" name="id" value={r.id} />
                  <select name="status" defaultValue={r.status} className="status" aria-label="Status">
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <button className="linkButton" type="submit">Save</button>
                </form>
              </td>
            </tr>
          ))}
          {demo.map((d, i) => (
            <tr key={`demo-${i}`} className="demo">
              {cols.map((c) => (
                <td key={c.key} data-label={c.label}>{d[c.key] || "—"}</td>
              ))}
              <td data-label="Received">
                <span>
                  <span className="tag">Demo</span>
                </span>
              </td>
              <td data-label="Status">—</td>
            </tr>
          ))}
          {!rows.length && !demo.length && (
            <tr>
              <td colSpan={cols.length + 2}>Nothing yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
