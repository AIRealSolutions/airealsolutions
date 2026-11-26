// Unit tests for the Site Spec rules and for site.json itself. Run: npm run test:unit (Node 22.18+ strips TS types).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUMMARY_ROUTE, sanitizeSiteSpec, templateSiteSpec } from "../../lib/site-spec.ts";

const raw = JSON.parse(readFileSync(new URL("../../site.json", import.meta.url), "utf8"));

test("site.json is valid: nothing is dropped when it is cleaned", () => {
  const clean = sanitizeSiteSpec(raw);
  assert.equal(clean.pages.length, raw.pages.length, "a page was dropped (bad route or no usable sections)");
  raw.pages.forEach((p, i) => assert.equal(clean.pages[i].sections.length, p.sections.length, `a section on ${p.route} was dropped (unknown type or missing form/entity)`));
  assert.equal(clean.entities.length, raw.entities.length, "an entity was dropped");
  assert.equal(clean.forms.length, raw.forms.length, "a form was dropped (unknown entity or fields)");
  raw.forms.forEach((f, i) => assert.deepEqual(clean.forms[i].fields, f.fields, `form ${f.key} lists fields its entity does not have`));
  assert.ok(clean.pages.some((p) => p.route === "/"), "there is no home page");
});

test("every button points at a page that exists", () => {
  const clean = sanitizeSiteSpec(raw);
  const routes = new Set(clean.pages.map((p) => p.route));
  for (const p of raw.pages) for (const s of p.sections) if (s.cta_route) assert.ok(routes.has(s.cta_route), `${p.route}: button goes to missing page ${s.cta_route}`);
});

test("unknown section types and dangling references are dropped", () => {
  const clean = sanitizeSiteSpec({
    brand: { name: "X", primary_color: "red" },
    pages: [{ route: "Home", sections: [{ type: "carousel" }, { type: "form", form: "nope" }, { type: "table", entity: "ghost" }, { type: "text", heading: "Hi" }] }],
    entities: [],
    forms: [{ key: "f", entity: "ghost", fields: ["a"] }],
  });
  assert.equal(clean.brand.primary_color, "#1d4ed8", "bad color falls back");
  assert.equal(clean.pages[0].route, "/");
  assert.deepEqual(clean.pages[0].sections.map((s) => s.type), ["text"]);
  assert.equal(clean.forms.length, 0);
});

test("the investor summary route is reserved", () => {
  const clean = sanitizeSiteSpec({ pages: [{ route: "/", sections: [{ type: "text", heading: "a" }] }, { route: SUMMARY_ROUTE, sections: [{ type: "text", heading: "b" }] }] });
  assert.deepEqual(clean.pages.map((p) => p.route), ["/"]);
});

test("the template builds a working spec", () => {
  const spec = templateSiteSpec("Demo", { product_summary: "A demo. It works.", requirements: ["One", "Later: two"] });
  assert.deepEqual(spec.pages.map((p) => p.route), ["/", "/contact", "/dashboard"]);
  assert.equal(spec.forms[0].entity, "leads");
});
