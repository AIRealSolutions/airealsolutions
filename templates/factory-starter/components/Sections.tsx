// Renders one Site Spec section. Server component; the form and the records table bring their own pieces.
import Link from "next/link";
import { entityOf, findForm, site } from "@/lib/site";
import type { SiteSection } from "@/lib/site-spec";
import RecordsTable from "./RecordsTable";
import SiteForm from "./SiteForm";

export function Paras({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n+/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </>
  );
}

export default function Section({ s }: { s: SiteSection }) {
  const cta = s.cta_label && s.cta_route ? <Link className="button" href={s.cta_route}>{s.cta_label}</Link> : null;
  const head = (
    <>
      {s.heading && <h2>{s.heading}</h2>}
      {s.body && <Paras text={s.body} />}
    </>
  );
  switch (s.type) {
    case "hero":
      return (
        <section className="hero">
          <h1>{s.heading || site.brand.name}</h1>
          {s.body && <Paras text={s.body} />}
          {cta}
        </section>
      );
    case "features":
      return (
        <section className="block">
          {head}
          <div className="cards">
            {s.items.map((it, i) => (
              <article key={i} className="card">
                {it.title && <h3>{it.title}</h3>}
                {it.body && it.body !== it.title && <p>{it.body}</p>}
              </article>
            ))}
          </div>
          {cta}
        </section>
      );
    case "testimonials":
      return (
        <section className="block">
          {head}
          <div className="cards">
            {s.items.map((it, i) => (
              <figure key={i} className="card">
                <blockquote>“{it.body}”</blockquote>
                <figcaption>{it.title}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      );
    case "steps":
      return (
        <section className="block">
          {head}
          <ol className="steps">
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
        <section className="block">
          {head}
          <div className="stats">
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
        <section className="block">
          {head}
          <div className="cards">
            {s.items.map((it, i) => (
              <article key={i} className="card plan">
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
        <section className="block">
          {head}
          <div className="faq">
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
        <section className="block text">
          {head}
          {cta}
        </section>
      );
    case "cta":
      return (
        <section className="ctaBand">
          {s.heading && <h2>{s.heading}</h2>}
          {s.body && <p>{s.body}</p>}
          {cta}
        </section>
      );
    case "form": {
      const form = findForm(s.form);
      const entity = form && entityOf(form.entity);
      if (!form || !entity) return null;
      const fields = form.fields.map((k) => entity.fields.find((f) => f.key === k)).filter((f) => f !== undefined);
      return (
        <section className="block">
          {head}
          <SiteForm form={form} fields={fields} />
        </section>
      );
    }
    case "table": {
      const entity = entityOf(s.entity);
      if (!entity) return null;
      return (
        <section className="block">
          {head}
          <RecordsTable entity={entity} />
        </section>
      );
    }
    default:
      return null;
  }
}
