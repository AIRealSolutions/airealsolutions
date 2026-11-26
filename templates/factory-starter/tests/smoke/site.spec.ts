// Smoke tests generated from site.json: every page loads, every form works, the dashboard is protected.
// They follow site.json, so they keep covering the site as the Code Agent changes it.
import { expect, test, type Page } from "@playwright/test";
import raw from "../../site.json" with { type: "json" };
import { sanitizeSiteSpec, type SiteField } from "../../lib/site-spec.ts";

const site = sanitizeSiteSpec(raw);
const connected = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

const sample = (f: SiteField) =>
  ({ email: "smoke@example.com", phone: "910-555-0100", number: "3", money: "49.99", date: "2026-01-15", textarea: "Smoke test message.", select: f.options[0] ?? "" })[f.type as string] ??
  "Smoke Test";

for (const p of site.pages) {
  test(`page ${p.route} loads, shows its content and fits the screen`, async ({ page }) => {
    const errors = watchErrors(page);
    const res = await page.goto(p.route);
    expect(res?.status(), "HTTP status").toBe(200);
    const first = p.sections.find((s) => s.heading || s.type === "hero");
    if (first) await expect(page.getByText(first.heading || site.brand.name, { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: p.nav_label })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "no sideways scrolling").toBeLessThanOrEqual(1);
    expect(errors, "no browser errors").toEqual([]);
  });
}

test("navigation reaches every page", async ({ page }) => {
  await page.goto("/");
  for (const p of site.pages) {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: p.nav_label }).click();
    await expect(page).toHaveURL(new RegExp(`${p.route === "/" ? "/$" : p.route}$`));
  }
});

test("an unknown page is a 404", async ({ page }) => {
  const res = await page.goto("/no-such-page-here");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Page not found")).toBeVisible();
});

for (const form of site.forms) {
  const entity = site.entities.find((e) => e.key === form.entity)!;
  const fields = form.fields.map((k) => entity.fields.find((f) => f.key === k)!);
  const where = site.pages.find((p) => p.sections.some((s) => s.type === "form" && s.form === form.key));

  if (where) {
    test(`form ${form.key} can be filled in and sent on ${where.route}`, async ({ page }) => {
      await page.goto(where.route);
      const el = page.getByRole("form", { name: form.title || form.key });
      await page.waitForTimeout(1600); // the anti-bot timer ignores instant submits
      for (const f of fields) {
        const input = el.locator(`[name="${f.key}"]`);
        if (f.type === "select") await input.selectOption(sample(f));
        else await input.fill(sample(f));
      }
      await el.getByRole("button", { name: form.submit_label }).click();
      if (connected) await expect(page.getByText(form.success_message)).toBeVisible();
      else await expect(page.getByText("not connected to its database")).toBeVisible();
    });
  }

  test(`form ${form.key} API refuses bad input`, async ({ request }) => {
    const good = Object.fromEntries(fields.map((f) => [f.key, sample(f)]));
    const required = fields.find((f) => f.required);
    if (required) {
      const r = await request.post(`/api/forms/${form.key}`, { data: { values: { ...good, [required.key]: "" }, elapsed: 5000 } });
      expect(r.status(), "missing required field").toBe(400);
    }
    const email = fields.find((f) => f.type === "email");
    if (email) {
      const r = await request.post(`/api/forms/${form.key}`, { data: { values: { ...good, [email.key]: "not-an-email" }, elapsed: 5000 } });
      expect(r.status(), "bad email").toBe(400);
    }
    const bot = await request.post(`/api/forms/${form.key}`, { data: { values: good, website: "spam.example", elapsed: 5000 } });
    expect(bot.status(), "honeypot gets a quiet OK").toBe(200);
    const unknown = await request.post(`/api/forms/no_such_form`, { data: { values: good } });
    expect(unknown.status()).toBe(404);
  });
}

for (const p of site.pages.filter((pg) => pg.sections.some((s) => s.type === "table"))) {
  test(`records on ${p.route} are not shown to visitors`, async ({ page }) => {
    await page.goto(p.route);
    if (connected) await expect(page.getByText("Sign in")).toBeVisible();
    else await expect(page.getByText("database is not connected yet")).toBeVisible();
    await expect(page.locator("table tbody tr:not(.demo) select")).toHaveCount(0);
  });
}
