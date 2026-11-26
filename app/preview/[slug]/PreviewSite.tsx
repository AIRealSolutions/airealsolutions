"use client";
// Draws a Site Spec with the fixed section library. Forms really save (factory_preview_submit) and
// dashboard tables show demo rows plus saved records (all of them for project members, a visitor's own otherwise).
// Investor links (?invite=<token>) are exchanged once for a 12-hour pass (factory_preview_open), kept in this
// browser, and every page a non-member opens is recorded (factory_preview_track).
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { factoryToken } from "../../factory/connections/session";
import { SUMMARY_ROUTE, sanitizeSiteSpec, type SiteEntity, type SiteForm, type SiteSection, type SiteSpec } from "../../lib/site-spec";
import InvestorSummary, { type Summary } from "./InvestorSummary";
import styles from "./preview.module.css";

const SUPABASE_URL = "https://xqdsmbyealtammgmpsqe.supabase.co";
const SUPABASE_KEY = "sb_publishable_78q5LVudkA7u2hqsecLmAw_br2XlkUB";
const VISITOR_KEY = "airealsolutions.preview.visitor.v1";
const passKey = (slug: string) => `airealsolutions.preview.pass.v1:${slug}`;

type Loaded = {
  project: { name: string; slug: string };
  spec: { id: string; version: number; status: string };
  content: SiteSpec;
  member: boolean;
  shared: boolean;
  invite: { label: string } | null;
  summary: Summary | null;
  grant: string | null;
};
type RecordRow = { id: string; data: Record<string, string>; created_at: string; mine: boolean };
type Pass = { grant: string; expires_at: string; invite: string };
type OpenResult = { grant?: string; expires_at?: string; needs_pin?: boolean; error?: string; member?: boolean; shared?: boolean };

function visitorId(): string | null {
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, v);
    }
    return v;
  } catch {
    return null;
  }
}

function readPass(slug: string): Pass | null {
  try {
    const p = JSON.parse(localStorage.getItem(passKey(slug)) || "null") as Pass | null;
    return p?.grant && new Date(p.expires_at).getTime() > Date.now() + 60_000 ? p : null;
  } catch {
    return null;
  }
}
function savePass(slug: string, pass: Pass | null) {
  try {
    if (pass) localStorage.setItem(passKey(slug), JSON.stringify(pass));
    else localStorage.removeItem(passKey(slug));
  } catch {
    /* private window: the pass lasts for this page only */
  }
}

/** Call a preview RPC as the Factory member when signed in, otherwise as an anonymous visitor. */
async function rpc<T>(fn: string, args: object): Promise<T> {
  const token = await factoryToken().catch(() => null);
  const call = (bearer: string) =>
    fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  let r = await call(token || SUPABASE_KEY);
  if (r.status === 401 && token) r = await call(SUPABASE_KEY); // stale session: try as a visitor
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.message || "The preview could not be loaded.");
  return d as T;
}

export default function PreviewSite({ slug, route, version, invite }: { slug: string; route: string; version: number | null; invite: string | null }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [needsPin, setNeedsPin] = useState<{ error: string } | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const tracked = useRef<string | null>(null);

  const load = useCallback(
    async (grant: string | null) => {
      const d = await rpc<{
        project: Loaded["project"];
        spec: Loaded["spec"] & { content: unknown };
        member: boolean;
        shared: boolean;
        invite: Loaded["invite"];
        summary: Summary | null;
      }>("factory_preview_get", { p_slug: slug, p_version: version, p_grant: grant });
      setData({
        project: d.project,
        spec: { id: d.spec.id, version: d.spec.version, status: d.spec.status },
        content: sanitizeSiteSpec(d.spec.content, d.project.name),
        member: d.member,
        shared: d.shared,
        invite: d.invite ?? null,
        summary: d.summary ?? null,
        grant,
      });
    },
    [slug, version],
  );

  /** Exchange the invite link (and PIN) for a pass, or record a public/shared view. Returns the grant to use. */
  const open = useCallback(
    async (pin: string | null): Promise<string | null | undefined> => {
      const r = await rpc<OpenResult>("factory_preview_open", { p_slug: slug, p_invite: invite, p_pin: pin, p_visitor: visitorId(), p_path: route });
      tracked.current = route;
      if (r.needs_pin) {
        setNeedsPin({ error: r.error || "" });
        return undefined;
      }
      if (r.error) throw new Error(r.error);
      if (r.grant && invite) {
        savePass(slug, { grant: r.grant, expires_at: r.expires_at || new Date(Date.now() + 12 * 3600_000).toISOString(), invite });
        return r.grant;
      }
      return null;
    },
    [slug, invite, route],
  );

  // First load: reuse a saved pass, otherwise open the link.
  useEffect(() => {
    let live = true;
    (async () => {
      const saved = readPass(slug);
      let grant: string | null | undefined = saved && (!invite || saved.invite === invite) ? saved.grant : undefined;
      if (grant === undefined) {
        grant = await open(null);
        if (grant === undefined) return; // waiting for the PIN
      }
      try {
        await load(grant);
      } catch (e) {
        if (!saved || grant !== saved.grant) throw e;
        // The saved pass stopped working (expired or the link was turned off): try the link once more.
        savePass(slug, null);
        if (!invite) throw e;
        const fresh = await open(null);
        if (fresh === undefined) return;
        await load(fresh);
      }
    })().catch((e) => live && setError(e instanceof Error ? e.message : "The preview could not be loaded."));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per preview, not on page changes
  }, [slug, version, invite]);

  // Record each further page a non-member opens.
  useEffect(() => {
    if (!data || data.member || tracked.current === route) return;
    tracked.current = route;
    void rpc("factory_preview_track", { p_slug: slug, p_grant: data.grant, p_visitor: visitorId(), p_path: route }).catch(() => null);
  }, [data, route, slug]);

  async function submitPin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const pin = String(new FormData(e.currentTarget).get("pin") || "").trim();
    setPinBusy(true);
    try {
      const grant = await open(pin);
      if (grant === undefined) return;
      setNeedsPin(null);
      await load(grant);
    } catch (err) {
      setNeedsPin(null);
      setError(err instanceof Error ? err.message : "The preview could not be loaded.");
    } finally {
      setPinBusy(false);
    }
  }

  if (error) {
    return (
      <div className={styles.empty}>
        <h1>Preview not available</h1>
        <p>{error}</p>
        {!invite && (
          <>
            <p>If this is your project, sign in to the Factory and open it again.</p>
            <p>
              <a href={`/login?next=${encodeURIComponent(`/preview/${slug}`)}`}>Sign in</a>
            </p>
          </>
        )}
      </div>
    );
  }
  if (needsPin) {
    return (
      <div className={styles.empty}>
        <h1>Enter your PIN</h1>
        <p>This prototype was shared with you privately. Enter the PIN you were given with the link.</p>
        <form className={styles.pinForm} onSubmit={(e) => void submitPin(e)}>
          <input name="pin" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4,8}" maxLength={8} required aria-label="PIN" autoFocus />
          <button className={styles.pinButton} disabled={pinBusy}>
            {pinBusy ? "Checking…" : "Open"}
          </button>
        </form>
        {needsPin.error && <p className={styles.error}>{needsPin.error}</p>}
      </div>
    );
  }
  if (!data) return <div className={styles.empty}><p>Loading preview…</p></div>;

  const spec = data.content;
  const isSummary = route === SUMMARY_ROUTE && Boolean(data.summary);
  const page = spec.pages.find((p) => p.route === route);
  const params = new URLSearchParams();
  if (version) params.set("v", String(version));
  if (invite) params.set("invite", invite);
  const q = params.size ? `?${params}` : "";
  const href = (r: string) => `/preview/${slug}${r === "/" ? "" : r}${q}`;
  const theme = { "--p": spec.brand.primary_color, "--a": spec.brand.accent_color } as CSSProperties;

  return (
    <div className={styles.site} style={theme}>
      <div className={styles.banner}>
        <span>
          <b>Prototype</b> built by AI Real Solutions · sample data is marked “Demo”
          {data.invite && <> · prepared for {data.invite.label}</>}
        </span>
        {data.member && (
          <span>
            v{data.spec.version} · {data.spec.status}
            {data.spec.status === "approved" && data.shared ? " · shared" : " · members only"} · <a href={`/factory/projects/${slug}#site-preview`}>Factory project</a>
          </span>
        )}
      </div>
      <header className={styles.header}>
        <Link href={href("/")} className={styles.logo}>
          <span style={{ background: spec.brand.primary_color }}>{spec.brand.name.slice(0, 1)}</span>
          {spec.brand.name}
        </Link>
        <nav className={styles.nav}>
          {spec.pages.map((p) => (
            <Link key={p.route} href={href(p.route)} className={p.route === route ? styles.current : ""}>
              {p.nav_label}
            </Link>
          ))}
          {data.summary && (
            <Link href={href(SUMMARY_ROUTE)} className={`${styles.summaryLink} ${isSummary ? styles.current : ""}`}>
              Investor summary
            </Link>
          )}
        </nav>
      </header>
      <main className={styles.main}>
        {isSummary ? (
          <InvestorSummary name={spec.brand.name} summary={data.summary!} preparedFor={data.invite?.label ?? null} />
        ) : page ? (
          page.sections.map((s, i) => <Section key={`${route}-${i}`} s={s} spec={spec} data={data} slug={slug} href={href} refresh={refresh} onSaved={() => setRefresh((n) => n + 1)} />)
        ) : (
          <div className={styles.empty}>
            <h1>Page not found</h1>
            <p>
              <Link href={href("/")}>Back to the home page</Link>
            </p>
          </div>
        )}
      </main>
      <footer className={styles.footer}>
        <span>© {new Date().getFullYear()} {spec.brand.name}</span>
        <span>{spec.brand.tagline}</span>
      </footer>
    </div>
  );
}

type SectionProps = { s: SiteSection; spec: SiteSpec; data: Loaded; slug: string; href: (r: string) => string; refresh: number; onSaved: () => void };

function Section({ s, spec, data, slug, href, refresh, onSaved }: SectionProps) {
  const cta = s.cta_label && s.cta_route ? <Link className={styles.button} href={href(s.cta_route)}>{s.cta_label}</Link> : null;
  const head = (
    <>
      {s.heading && <h2>{s.heading}</h2>}
      {s.body && <Paras text={s.body} />}
    </>
  );
  switch (s.type) {
    case "hero":
      return (
        <section className={styles.hero}>
          <h1>{s.heading || spec.brand.name}</h1>
          {s.body && <Paras text={s.body} />}
          {cta}
        </section>
      );
    case "features":
    case "testimonials":
      return (
        <section className={styles.block}>
          {head}
          <div className={styles.cards}>
            {s.items.map((it, i) =>
              s.type === "testimonials" ? (
                <figure key={i} className={styles.card}>
                  <blockquote>“{it.body}”</blockquote>
                  <figcaption>{it.title}</figcaption>
                </figure>
              ) : (
                <article key={i} className={styles.card}>
                  {it.title && <h3>{it.title}</h3>}
                  {it.body && it.body !== it.title && <p>{it.body}</p>}
                </article>
              ),
            )}
          </div>
          {cta}
        </section>
      );
    case "steps":
      return (
        <section className={styles.block}>
          {head}
          <ol className={styles.steps}>
            {s.items.map((it, i) => (
              <li key={i}>
                <b>{i + 1}</b>
                <span>
                  <strong>{it.title}</strong>
                  {it.body && it.body !== it.title && <small>{it.body}</small>}
                </span>
              </li>
            ))}
          </ol>
          {cta}
        </section>
      );
    case "stats":
      return (
        <section className={styles.block}>
          {head}
          <div className={styles.stats}>
            {s.items.map((it, i) => (
              <div key={i}>
                <strong>{it.value || "—"}</strong>
                <span>{it.title}</span>
              </div>
            ))}
          </div>
        </section>
      );
    case "pricing":
      return (
        <section className={styles.block}>
          {head}
          <div className={styles.cards}>
            {s.items.map((it, i) => (
              <article key={i} className={`${styles.card} ${styles.plan}`}>
                <h3>{it.title}</h3>
                {it.value && <strong>{it.value}</strong>}
                {it.body && <p>{it.body}</p>}
                {it.points.length > 0 && (
                  <ul>
                    {it.points.map((p, j) => (
                      <li key={j}>{p}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
          {cta}
        </section>
      );
    case "faq":
      return (
        <section className={styles.block}>
          {head}
          <div className={styles.faq}>
            {s.items.map((it, i) => (
              <details key={i}>
                <summary>{it.title}</summary>
                <p>{it.body}</p>
              </details>
            ))}
          </div>
        </section>
      );
    case "text":
      return (
        <section className={`${styles.block} ${styles.text}`}>
          {head}
          {cta}
        </section>
      );
    case "cta":
      return (
        <section className={styles.ctaBand}>
          {s.heading && <h2>{s.heading}</h2>}
          {s.body && <p>{s.body}</p>}
          {cta}
        </section>
      );
    case "form": {
      const form = spec.forms.find((f) => f.key === s.form);
      const entity = form && spec.entities.find((e) => e.key === form.entity);
      if (!form || !entity) return null;
      return (
        <section className={styles.block}>
          {head}
          <PreviewForm form={form} entity={entity} slug={slug} specId={data.spec.id} grant={data.grant} onSaved={onSaved} />
        </section>
      );
    }
    case "table": {
      const entity = spec.entities.find((e) => e.key === s.entity);
      if (!entity) return null;
      return (
        <section className={styles.block}>
          {head}
          <RecordsTable entity={entity} demo={spec.demo_data.find((d) => d.entity === entity.key)?.rows ?? []} slug={slug} member={data.member} grant={data.grant} refresh={refresh} />
        </section>
      );
    }
    default:
      return null;
  }
}

function Paras({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n+/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </>
  );
}

const inputType = (t: string) => ({ email: "email", phone: "tel", number: "number", money: "number", date: "date" })[t] || "text";

function PreviewForm({ form, entity, slug, specId, grant, onSaved }: { form: SiteForm; entity: SiteEntity; slug: string; specId: string; grant: string | null; onSaved: () => void }) {
  const [status, setStatus] = useState<"" | "sending" | "done">("");
  const [error, setError] = useState("");
  const fields = form.fields.map((k) => entity.fields.find((f) => f.key === k)!).filter(Boolean);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const values: Record<string, string> = {};
    for (const f of fields) values[f.key] = String(fd.get(f.key) ?? "").trim();
    setStatus("sending");
    setError("");
    try {
      await rpc("factory_preview_submit", { p_slug: slug, p_spec: specId, p_form: form.key, p_data: values, p_visitor: visitorId(), p_grant: grant });
      setStatus("done");
      onSaved();
    } catch (err) {
      setStatus("");
      setError(err instanceof Error ? err.message : "It could not be sent.");
    }
  }

  if (status === "done") {
    return (
      <div className={styles.done}>
        <h3>{form.success_message}</h3>
        <p>It was saved to this prototype’s database. Open the dashboard page to see it.</p>
        <button type="button" className={styles.linkButton} onClick={() => setStatus("")}>
          Send another
        </button>
      </div>
    );
  }
  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)}>
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
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.button} disabled={status === "sending"}>
        {status === "sending" ? "Sending…" : form.submit_label}
      </button>
    </form>
  );
}

function RecordsTable({ entity, demo, slug, member, grant, refresh }: { entity: SiteEntity; demo: Record<string, string>[]; slug: string; member: boolean; grant: string | null; refresh: number }) {
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    rpc<RecordRow[]>("factory_preview_records", { p_slug: slug, p_entity: entity.key, p_visitor: visitorId(), p_grant: grant })
      .then((r) => {
        setRows(Array.isArray(r) ? r : []);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Records could not be loaded."));
  }, [slug, entity.key, grant]);
  useEffect(load, [load, refresh]);

  const cols = entity.fields.slice(0, 6);
  return (
    <div className={styles.tableWrap}>
      <p className={styles.note}>
        {member ? "You are signed in to the Factory, so you see every record sent on this preview." : "You see the demo rows and anything you sent from this browser."}
      </p>
      {error && <p className={styles.error}>{error}</p>}
      <table className={styles.table}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
            <th>Received</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {cols.map((c) => (
                <td key={c.key} data-label={c.label}>{r.data[c.key] || "—"}</td>
              ))}
              <td data-label="Received">
                <span>
                  {new Date(r.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {r.mine && <span className={styles.tag}>You</span>}
                </span>
              </td>
            </tr>
          ))}
          {demo.map((d, i) => (
            <tr key={`demo-${i}`} className={styles.demo}>
              {cols.map((c) => (
                <td key={c.key} data-label={c.label}>{d[c.key] || "—"}</td>
              ))}
              <td data-label="Received">
                <span>
                  <span className={styles.tag}>Demo</span>
                </span>
              </td>
            </tr>
          ))}
          {!rows.length && !demo.length && (
            <tr>
              <td colSpan={cols.length + 1}>Nothing yet. Send the form to see it here.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
