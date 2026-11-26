"use client";
// Draws a Site Spec with the fixed section library. Forms really save (factory_preview_submit) and
// dashboard tables show demo rows plus saved records (all of them for project members, a visitor's own otherwise).
import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { factoryToken } from "../../factory/connections/session";
import { sanitizeSiteSpec, type SiteEntity, type SiteForm, type SiteSection, type SiteSpec } from "../../lib/site-spec";
import styles from "./preview.module.css";

const SUPABASE_URL = "https://xqdsmbyealtammgmpsqe.supabase.co";
const SUPABASE_KEY = "sb_publishable_78q5LVudkA7u2hqsecLmAw_br2XlkUB";
const VISITOR_KEY = "airealsolutions.preview.visitor.v1";

type Loaded = { project: { name: string; slug: string }; spec: { id: string; version: number; status: string }; content: SiteSpec; member: boolean; shared: boolean };
type RecordRow = { id: string; data: Record<string, string>; created_at: string; mine: boolean };

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

export default function PreviewSite({ slug, route, version }: { slug: string; route: string; version: number | null }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let live = true;
    rpc<{ project: Loaded["project"]; spec: Loaded["spec"] & { content: unknown }; member: boolean; shared: boolean }>("factory_preview_get", {
      p_slug: slug,
      p_version: version,
    })
      .then((d) => {
        if (!live) return;
        setData({ project: d.project, spec: { id: d.spec.id, version: d.spec.version, status: d.spec.status }, content: sanitizeSiteSpec(d.spec.content, d.project.name), member: d.member, shared: d.shared });
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "The preview could not be loaded."));
    return () => {
      live = false;
    };
  }, [slug, version]);

  if (error) {
    return (
      <div className={styles.empty}>
        <h1>Preview not available</h1>
        <p>{error}</p>
        <p>If this is your project, sign in to the Factory and open it again.</p>
        <p>
          <a href={`/login?next=${encodeURIComponent(`/preview/${slug}`)}`}>Sign in</a>
        </p>
      </div>
    );
  }
  if (!data) return <div className={styles.empty}><p>Loading preview…</p></div>;

  const spec = data.content;
  const page = spec.pages.find((p) => p.route === route);
  const q = version ? `?v=${version}` : "";
  const href = (r: string) => `/preview/${slug}${r === "/" ? "" : r}${q}`;
  const theme = { "--p": spec.brand.primary_color, "--a": spec.brand.accent_color } as CSSProperties;

  return (
    <div className={styles.site} style={theme}>
      <div className={styles.banner}>
        <span>
          <b>Prototype</b> built by AI Real Solutions · sample data is marked “Demo”
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
        </nav>
      </header>
      <main className={styles.main}>
        {page ? (
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
          <PreviewForm form={form} entity={entity} slug={slug} specId={data.spec.id} onSaved={onSaved} />
        </section>
      );
    }
    case "table": {
      const entity = spec.entities.find((e) => e.key === s.entity);
      if (!entity) return null;
      return (
        <section className={styles.block}>
          {head}
          <RecordsTable entity={entity} demo={spec.demo_data.find((d) => d.entity === entity.key)?.rows ?? []} slug={slug} member={data.member} refresh={refresh} />
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

function PreviewForm({ form, entity, slug, specId, onSaved }: { form: SiteForm; entity: SiteEntity; slug: string; specId: string; onSaved: () => void }) {
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
      await rpc("factory_preview_submit", { p_slug: slug, p_spec: specId, p_form: form.key, p_data: values, p_visitor: visitorId() });
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

function RecordsTable({ entity, demo, slug, member, refresh }: { entity: SiteEntity; demo: Record<string, string>[]; slug: string; member: boolean; refresh: number }) {
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    rpc<RecordRow[]>("factory_preview_records", { p_slug: slug, p_entity: entity.key, p_visitor: visitorId() })
      .then((r) => {
        setRows(Array.isArray(r) ? r : []);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Records could not be loaded."));
  }, [slug, entity.key]);
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
