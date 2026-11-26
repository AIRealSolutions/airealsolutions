// Site Spec: the small, strict description of a basic site that the instant preview
// (/preview/<slug>) draws and, later, the Code Agent builds from.
// Shared by the server (Site Agent, template) and the browser (renderer). No secrets here.

export const SECTION_TYPES = [
  "hero", // big heading, sub-heading, call to action
  "features", // cards: title + body
  "steps", // numbered how-it-works
  "stats", // big numbers: value + title
  "pricing", // plans: title, value (price), body, bullet points
  "testimonials", // quotes: body + title (who)
  "faq", // questions (title) and answers (body)
  "text", // a heading and paragraphs
  "cta", // closing banner with a button
  "form", // a working form (form key)
  "table", // a signed-in style dashboard list of an entity's records
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

/** Reserved preview route for the investor one-pager; a Site Spec page may not use it. */
export const SUMMARY_ROUTE = "/investor-summary";

export const FIELD_TYPES = ["text", "email", "phone", "number", "money", "date", "textarea", "select"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type SiteItem = { title: string; body: string; value: string; points: string[] };
export type SiteSection = {
  type: SectionType;
  heading: string;
  body: string;
  items: SiteItem[];
  form: string; // form key, for "form"
  entity: string; // entity key, for "table"
  cta_label: string;
  cta_route: string; // a page route in this spec, e.g. "/contact"
};
export type SitePage = { route: string; title: string; nav_label: string; sections: SiteSection[] };
export type SiteField = { key: string; label: string; type: FieldType; required: boolean; options: string[] };
export type SiteEntity = { key: string; label: string; fields: SiteField[] };
export type SiteForm = {
  key: string;
  entity: string;
  title: string;
  submit_label: string;
  success_message: string;
  fields: string[]; // field keys of the entity
};
export type SiteAutomation = { trigger: string; action: string; needs_approval: boolean };
export type SiteDemo = { entity: string; rows: Record<string, string>[] };
export type SiteSpec = {
  brand: { name: string; tagline: string; primary_color: string; accent_color: string; tone: string };
  pages: SitePage[];
  entities: SiteEntity[];
  forms: SiteForm[];
  automations: SiteAutomation[];
  demo_data: SiteDemo[];
};

/** JSON schema for structured output. Demo rows are field/value pairs (objects with open keys are not allowed). */
export const SITE_SPEC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["brand", "pages", "entities", "forms", "automations", "demo_data"],
  properties: {
    brand: {
      type: "object",
      additionalProperties: false,
      required: ["name", "tagline", "primary_color", "accent_color", "tone"],
      properties: {
        name: { type: "string" },
        tagline: { type: "string" },
        primary_color: { type: "string", description: "Hex color like #1d4ed8, dark enough for white text" },
        accent_color: { type: "string", description: "Hex color like #f59e0b" },
        tone: { type: "string" },
      },
    },
    pages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["route", "title", "nav_label", "sections"],
        properties: {
          route: { type: "string", description: '"/" for the home page, otherwise "/" + lowercase-words-with-hyphens' },
          title: { type: "string" },
          nav_label: { type: "string" },
          sections: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["type", "heading", "body", "items", "form", "entity", "cta_label", "cta_route"],
              properties: {
                type: { type: "string", enum: [...SECTION_TYPES] },
                heading: { type: "string" },
                body: { type: "string" },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["title", "body", "value", "points"],
                    properties: {
                      title: { type: "string" },
                      body: { type: "string" },
                      value: { type: "string" },
                      points: { type: "array", items: { type: "string" } },
                    },
                  },
                },
                form: { type: "string" },
                entity: { type: "string" },
                cta_label: { type: "string" },
                cta_route: { type: "string" },
              },
            },
          },
        },
      },
    },
    entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label", "fields"],
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          fields: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["key", "label", "type", "required", "options"],
              properties: {
                key: { type: "string" },
                label: { type: "string" },
                type: { type: "string", enum: [...FIELD_TYPES] },
                required: { type: "boolean" },
                options: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
    },
    forms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "entity", "title", "submit_label", "success_message", "fields"],
        properties: {
          key: { type: "string" },
          entity: { type: "string" },
          title: { type: "string" },
          submit_label: { type: "string" },
          success_message: { type: "string" },
          fields: { type: "array", items: { type: "string" } },
        },
      },
    },
    automations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["trigger", "action", "needs_approval"],
        properties: { trigger: { type: "string" }, action: { type: "string" }, needs_approval: { type: "boolean" } },
      },
    },
    demo_data: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["entity", "rows"],
        properties: {
          entity: { type: "string" },
          rows: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["values"],
              properties: {
                values: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["field", "value"],
                    properties: { field: { type: "string" }, value: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

// ---- sanitizing ---------------------------------------------------------------

const LIMITS = { pages: 8, sections: 12, items: 12, points: 8, entities: 6, fields: 14, forms: 6, automations: 12, demoRows: 8 };

const str = (v: unknown, max = 400) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const para = (v: unknown, max = 2000) => (typeof v === "string" ? v.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export const toKey = (v: unknown) =>
  str(v, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f_$1")
    .slice(0, 40);

export function toRoute(v: unknown): string {
  const s = str(v, 80).toLowerCase();
  if (!s || s === "/" || s === "home" || s === "/home") return "/";
  const slug = s.replace(/^\/+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug ? `/${slug}` : "/";
}

const color = (v: unknown, fallback: string) => {
  const s = str(v, 9);
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : /^#[0-9a-f]{3}$/i.test(s) ? "#" + [...s.slice(1)].map((c) => c + c).join("").toLowerCase() : fallback;
};

/**
 * Clean any candidate spec (AI output, template, or a stored row) into something the renderer can draw.
 * Unknown section types, dangling form/entity references and bad routes are dropped, never trusted.
 */
export function sanitizeSiteSpec(raw: unknown, fallbackName = "Your product"): SiteSpec {
  const r = obj(raw);
  const b = obj(r.brand);
  const brand = {
    name: str(b.name, 80) || fallbackName,
    tagline: str(b.tagline, 200),
    primary_color: color(b.primary_color, "#1d4ed8"),
    accent_color: color(b.accent_color, "#f59e0b"),
    tone: str(b.tone, 120),
  };

  const entities: SiteEntity[] = [];
  for (const e of arr(r.entities).slice(0, LIMITS.entities)) {
    const eo = obj(e);
    const key = toKey(eo.key || eo.label);
    if (!key || entities.some((x) => x.key === key)) continue;
    const fields: SiteField[] = [];
    for (const f of arr(eo.fields).slice(0, LIMITS.fields)) {
      const fo = obj(f);
      const fkey = toKey(fo.key || fo.label);
      if (!fkey || fields.some((x) => x.key === fkey)) continue;
      const type = (FIELD_TYPES as readonly string[]).includes(String(fo.type)) ? (fo.type as FieldType) : "text";
      const options = arr(fo.options).map((o) => str(o, 60)).filter(Boolean).slice(0, 12);
      fields.push({
        key: fkey,
        label: str(fo.label, 60) || fkey.replace(/_/g, " "),
        type: type === "select" && !options.length ? "text" : type,
        required: fo.required === true,
        options: type === "select" ? options : [],
      });
    }
    if (fields.length) entities.push({ key, label: str(eo.label, 60) || key.replace(/_/g, " "), fields });
  }

  const forms: SiteForm[] = [];
  for (const f of arr(r.forms).slice(0, LIMITS.forms)) {
    const fo = obj(f);
    const key = toKey(fo.key || fo.title);
    const entity = entities.find((e) => e.key === toKey(fo.entity));
    if (!key || !entity || forms.some((x) => x.key === key)) continue;
    const wanted = arr(fo.fields).map(toKey);
    const fields = (wanted.length ? wanted : entity.fields.map((x) => x.key)).filter(
      (k, i, all) => entity.fields.some((x) => x.key === k) && all.indexOf(k) === i,
    );
    if (!fields.length) continue;
    forms.push({
      key,
      entity: entity.key,
      title: str(fo.title, 100),
      submit_label: str(fo.submit_label, 40) || "Send",
      success_message: str(fo.success_message, 200) || "Thanks! We received it.",
      fields,
    });
  }

  const pages: SitePage[] = [];
  for (const p of arr(r.pages).slice(0, LIMITS.pages)) {
    const po = obj(p);
    const route = toRoute(po.route);
    if (route === SUMMARY_ROUTE || pages.some((x) => x.route === route)) continue;
    const sections: SiteSection[] = [];
    for (const s of arr(po.sections).slice(0, LIMITS.sections)) {
      const so = obj(s);
      const type = String(so.type) as SectionType;
      if (!(SECTION_TYPES as readonly string[]).includes(type)) continue;
      const form = toKey(so.form);
      const entity = toKey(so.entity);
      if (type === "form" && !forms.some((f) => f.key === form)) continue;
      if (type === "table" && !entities.some((e) => e.key === entity)) continue;
      sections.push({
        type,
        heading: str(so.heading, 160),
        body: para(so.body),
        items: arr(so.items)
          .slice(0, LIMITS.items)
          .map((i) => {
            const io = obj(i);
            return {
              title: str(io.title, 120),
              body: para(io.body, 600),
              value: str(io.value, 40),
              points: arr(io.points).map((x) => str(x, 120)).filter(Boolean).slice(0, LIMITS.points),
            };
          })
          .filter((i) => i.title || i.body || i.value),
        form: type === "form" ? form : "",
        entity: type === "table" ? entity : "",
        cta_label: str(so.cta_label, 40),
        cta_route: so.cta_route ? toRoute(so.cta_route) : "",
      });
    }
    if (!sections.length) continue;
    pages.push({ route, title: str(po.title, 80) || route, nav_label: str(po.nav_label, 30) || str(po.title, 30) || route, sections });
  }
  if (pages.length && !pages.some((p) => p.route === "/")) pages[0].route = "/";
  pages.sort((a, b) => (a.route === "/" ? -1 : b.route === "/" ? 1 : 0));
  // Buttons may only point at pages that exist.
  for (const p of pages) for (const s of p.sections) if (s.cta_route && !pages.some((x) => x.route === s.cta_route)) s.cta_route = "";

  const automations = arr(r.automations)
    .slice(0, LIMITS.automations)
    .map((a) => {
      const ao = obj(a);
      return { trigger: str(ao.trigger, 200), action: str(ao.action, 300), needs_approval: ao.needs_approval === true };
    })
    .filter((a) => a.trigger && a.action);

  const demo_data: SiteDemo[] = [];
  for (const d of arr(r.demo_data)) {
    const dobj = obj(d);
    const entity = entities.find((e) => e.key === toKey(dobj.entity));
    if (!entity || demo_data.some((x) => x.entity === entity.key)) continue;
    const rows = arr(dobj.rows)
      .slice(0, LIMITS.demoRows)
      .map((row) => {
        const ro = obj(row);
        const out: Record<string, string> = {};
        // Either {values:[{field,value}]} (AI schema) or a plain object (template / stored).
        const pairs = Array.isArray(ro.values) ? ro.values.map((v) => [toKey(obj(v).field), obj(v).value] as const) : Object.entries(ro).map(([k, v]) => [toKey(k), v] as const);
        for (const [k, v] of pairs) if (entity.fields.some((f) => f.key === k)) out[k] = str(v, 300);
        return out;
      })
      .filter((row) => Object.keys(row).length);
    if (rows.length) demo_data.push({ entity: entity.key, rows });
  }

  return { brand, pages, entities, forms, automations, demo_data };
}

// ---- template (no AI) ---------------------------------------------------------

type SynthesisLike = Partial<Record<string, unknown>> & { product_summary?: string; problem_statement?: string };
const list = (s: SynthesisLike, k: string) => arr(s[k]).map((x) => str(x, 300)).filter(Boolean);
const firstSentence = (t: string) => (t.match(/^[^.!?]+[.!?]?/)?.[0] || t).trim().slice(0, 160);
const titleOf = (t: string) => {
  const s = t.replace(/^(Later:|MVP:)\s*/i, "").split(/[:—–-]\s/)[0];
  return s.length > 60 ? s.slice(0, 57).replace(/\s+\S*$/, "") + "…" : s;
};

/** A plain but working site built from the approved synthesis: home, contact form, dashboard. */
export function templateSiteSpec(projectName: string, synthesis: SynthesisLike | null): SiteSpec {
  const s = synthesis || {};
  const summary = str(s.product_summary, 600);
  const problem = str(s.problem_statement, 600);
  const reqs = list(s, "requirements").filter((r) => !/^later:/i.test(r)).slice(0, 6);
  const outcomes = list(s, "desired_outcomes").slice(0, 4);
  const flows = list(s, "workflows").slice(0, 5);
  const autos = list(s, "automation_opportunities").slice(0, 6);

  const spec = {
    brand: { name: projectName, tagline: summary ? firstSentence(summary) : `${projectName}, built by AI Real Solutions.`, primary_color: "#1d4ed8", accent_color: "#f59e0b", tone: "clear and friendly" },
    pages: [
      {
        route: "/",
        title: "Home",
        nav_label: "Home",
        sections: [
          { type: "hero", heading: projectName, body: summary || `${projectName} makes the work simpler.`, items: [], form: "", entity: "", cta_label: "Get started", cta_route: "/contact" },
          ...(problem ? [{ type: "text", heading: "The problem we solve", body: problem, items: [], form: "", entity: "", cta_label: "", cta_route: "" }] : []),
          {
            type: "features",
            heading: "What you get",
            body: "",
            items: (reqs.length ? reqs : ["Simple sign-in", "One place for your records", "Status at a glance"]).map((r) => ({ title: titleOf(r), body: r, value: "", points: [] })),
            form: "",
            entity: "",
            cta_label: "",
            cta_route: "",
          },
          ...(flows.length ? [{ type: "steps", heading: "How it works", body: "", items: flows.map((f) => ({ title: titleOf(f), body: f, value: "", points: [] })), form: "", entity: "", cta_label: "", cta_route: "" }] : []),
          ...(outcomes.length ? [{ type: "features", heading: "Results that matter", body: "", items: outcomes.map((o) => ({ title: titleOf(o), body: o, value: "", points: [] })), form: "", entity: "", cta_label: "", cta_route: "" }] : []),
          { type: "cta", heading: "Ready to see it work for you?", body: "Send us a note and we'll follow up.", items: [], form: "", entity: "", cta_label: "Contact us", cta_route: "/contact" },
        ],
      },
      {
        route: "/contact",
        title: "Contact",
        nav_label: "Contact",
        sections: [{ type: "form", heading: "Get in touch", body: "Tell us what you need. We reply within one business day.", items: [], form: "contact", entity: "", cta_label: "", cta_route: "" }],
      },
      {
        route: "/dashboard",
        title: "Dashboard",
        nav_label: "Dashboard",
        sections: [{ type: "table", heading: "New requests", body: "Every form sent on this site lands here.", items: [], form: "", entity: "leads", cta_label: "", cta_route: "" }],
      },
    ],
    entities: [
      {
        key: "leads",
        label: "Leads",
        fields: [
          { key: "name", label: "Name", type: "text", required: true, options: [] },
          { key: "email", label: "Email", type: "email", required: true, options: [] },
          { key: "phone", label: "Phone", type: "phone", required: false, options: [] },
          { key: "message", label: "How can we help?", type: "textarea", required: false, options: [] },
        ],
      },
    ],
    forms: [{ key: "contact", entity: "leads", title: "Contact us", submit_label: "Send", success_message: "Thanks! We received your message.", fields: ["name", "email", "phone", "message"] }],
    automations: (autos.length ? autos : ["New lead -> email the owner"]).map((a) => {
      const [trigger, action] = a.split(/\s*(?:->|→|:)\s*/);
      return { trigger: action ? trigger : "New lead", action: action || a, needs_approval: /send|pay|delete|publish|customer/i.test(a) };
    }),
    demo_data: [
      {
        entity: "leads",
        rows: [
          { name: "Jordan Lee", email: "jordan@example.com", phone: "910-555-0142", message: "Interested in a demo next week." },
          { name: "Sam Patel", email: "sam@example.com", phone: "", message: "What does setup cost?" },
          { name: "Riley Brooks", email: "riley@example.com", phone: "919-555-0178", message: "Can this work for a small team?" },
        ],
      },
    ],
  };
  return sanitizeSiteSpec(spec, projectName);
}
