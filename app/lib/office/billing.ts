// Billing: Stripe Checkout pay links, webhook verification, invoice emails, recurring invoices and
// overdue follow-ups. Server-only. Stripe is called over its REST API (no SDK dependency).
import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "../integrations/server";
import { addDays, type Rest } from "./server";

export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || "https://airealsolutions.com").replace(/\/+$/, "");
export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);
export const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
export const payLink = (token: string) => `${siteUrl()}/pay/${token}`;

export type Seller = { legal_name: string; billing_profile: { address?: string; email?: string; phone?: string; payment_terms_days?: number; payment_instructions?: string; footer?: string } };
export type InvoiceRow = {
  id: string; entity_id: string; customer_id: string; business_id: string | null; kind: "invoice" | "quote"; number: string; status: string;
  issue_date: string; due_date: string | null; memo: string | null; subtotal_cents: number; tax_cents: number; total_cents: number;
  paid_cents: number; balance_cents: number; public_token: string; dunning_stage: number;
};
export type LineRow = { description: string; quantity: number; unit_price_cents: number; amount_cents: number };

// ---- Stripe -------------------------------------------------------------------------------

async function stripe<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new HttpError(503, "Online payments are not set up yet (STRIPE_SECRET_KEY).");
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    cache: "no-store",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, `Stripe: ${data?.error?.message || `request failed (${r.status})`}`);
  return data as T;
}

/** A fresh Checkout Session for the invoice's open balance. Payment methods follow the Stripe dashboard (card, ACH...). */
export async function createCheckout(inv: InvoiceRow, customerEmail: string | null, label: string) {
  if (inv.kind !== "invoice") throw new HttpError(400, "Only invoices can be paid.");
  if (inv.status === "void" || inv.status === "draft") throw new HttpError(409, "This invoice is not open for payment.");
  if (inv.balance_cents <= 0) throw new HttpError(409, "This invoice is already paid.");
  const params: Record<string, string> = {
    mode: "payment",
    success_url: `${payLink(inv.public_token)}?paid=1`,
    cancel_url: payLink(inv.public_token),
    client_reference_id: inv.id,
    "metadata[invoice_id]": inv.id,
    "payment_intent_data[metadata][invoice_id]": inv.id,
    "payment_intent_data[description]": `${label} ${inv.number}`,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(inv.balance_cents),
    "line_items[0][price_data][product_data][name]": `${label} — invoice ${inv.number}`,
  };
  if (customerEmail) params.customer_email = customerEmail;
  return stripe<{ id: string; url: string }>("checkout/sessions", params);
}

/** Verify a Stripe-Signature header (v1 HMAC-SHA256 over "t.body"), 5-minute tolerance. */
export function verifyStripeSignature(body: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]).filter((p) => p.length === 2));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  return header.split(",").filter((p) => p.startsWith("v1=")).some((p) => {
    const given = Buffer.from(p.slice(3), "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Record a Stripe payment once (stripe_payment_ref is unique, so webhook retries do nothing). */
export async function recordStripePayment(rest: Rest, invoiceId: string, amountCents: number, ref: string) {
  const inv = (await rest<{ id: string; entity_id: string; customer_id: string }[]>(`bill_invoices?id=eq.${invoiceId}&select=id,entity_id,customer_id&limit=1`))[0];
  if (!inv) throw new HttpError(404, "Invoice not found for Stripe payment.");
  await rest("bill_payments?on_conflict=stripe_payment_ref", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ entity_id: inv.entity_id, invoice_id: inv.id, customer_id: inv.customer_id, amount_cents: amountCents, method: "stripe", reference: ref, stripe_payment_ref: ref }),
  });
}

// ---- Email text -----------------------------------------------------------------------------

export function invoiceEmail(
  inv: InvoiceRow, lines: LineRow[], seller: Seller, customerName: string, businessName: string | null, mode: "send" | "reminder",
) {
  const what = inv.kind === "quote" ? "quote" : "invoice";
  const label = businessName && businessName !== seller.legal_name ? `${businessName} (${seller.legal_name})` : seller.legal_name;
  const overdueDays = inv.due_date ? Math.floor((Date.parse(`${todayNY()}T12:00:00Z`) - Date.parse(`${inv.due_date}T12:00:00Z`)) / 86_400_000) : 0;
  const subject = mode === "reminder"
    ? `Reminder: invoice ${inv.number} — ${money(inv.balance_cents)} ${overdueDays > 0 ? `${overdueDays} days past due` : "due"}`
    : `${inv.kind === "quote" ? "Quote" : "Invoice"} ${inv.number} from ${businessName || seller.legal_name}`;
  const text = [
    `Hi ${customerName},`,
    "",
    mode === "reminder"
      ? `A friendly reminder that invoice ${inv.number} has a balance of ${money(inv.balance_cents)}${inv.due_date ? `, due ${inv.due_date}` : ""}.`
      : `Here is ${what} ${inv.number} from ${label}${inv.kind === "invoice" && inv.due_date ? `, due ${inv.due_date}` : ""}.`,
    "",
    ...lines.map((l) => `- ${l.description}: ${Number(l.quantity) !== 1 ? `${l.quantity} × ${money(l.unit_price_cents)} = ` : ""}${money(l.amount_cents)}`),
    ...(inv.tax_cents ? [`Tax: ${money(inv.tax_cents)}`] : []),
    `Total: ${money(inv.total_cents)}${inv.paid_cents ? ` · Paid: ${money(inv.paid_cents)} · Balance: ${money(inv.balance_cents)}` : ""}`,
    "",
    inv.kind === "quote" ? `View and accept the quote: ${payLink(inv.public_token)}` : `View and pay online: ${payLink(inv.public_token)}`,
    ...(inv.memo ? ["", inv.memo] : []),
    ...(seller.billing_profile.payment_instructions && inv.kind === "invoice" ? ["", seller.billing_profile.payment_instructions] : []),
    "",
    "Thank you,",
    seller.legal_name,
    ...[seller.billing_profile.email, seller.billing_profile.phone].filter(Boolean) as string[],
  ].join("\n");
  return { subject, text };
}

export async function sendViaResend(to: string, subject: string, text: string, replyTo?: string) {
  const key = process.env.RESEND_API_KEY, from = process.env.OFFICE_BILLING_FROM || process.env.OFFICE_BRIEF_FROM;
  if (!key || !from) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!r.ok) console.error("[billing] resend failed", r.status, await r.text().catch(() => ""));
  return r.ok;
}

const todayNY = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

// ---- Daily billing job (called from the morning cron) ------------------------------------------

type Sub = { id: string; entity_id: string; customer_id: string; business_id: string | null; name: string; interval: "month" | "year"; next_invoice_on: string; days_until_due: number; lines: { product_id?: string | null; description: string; quantity: number; unit_price_cents: number }[]; auto_send: boolean };

function nextDate(date: string, interval: "month" | "year") {
  const d = new Date(`${date}T12:00:00Z`);
  const day = d.getUTCDate();
  if (interval === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else { d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate())); }
  return d.toISOString().slice(0, 10);
}

const reminder = (rest: Rest, title: string, businessId: string | null) =>
  rest("office_reminders", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ title, business_id: businessId, remind_at: new Date().toISOString() }) });

/** Create invoices for due subscriptions and raise reminders for overdue invoices. */
export async function runBillingDaily(rest: Rest, today: string) {
  const created: string[] = [];
  const subs = await rest<Sub[]>(`bill_subscriptions?status=eq.active&next_invoice_on=lte.${today}&select=id,entity_id,customer_id,business_id,name,interval,next_invoice_on,days_until_due,lines,auto_send&limit=50`);
  for (const s of subs) {
    const inv = (await rest<InvoiceRow[]>("bill_invoices?select=*", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ entity_id: s.entity_id, customer_id: s.customer_id, business_id: s.business_id, kind: "invoice", issue_date: today, due_date: addDays(today, s.days_until_due), subscription_id: s.id, memo: s.name }),
    }))[0];
    const lines = (s.lines || []).filter((l) => l.description && l.unit_price_cents >= 0).map((l, i) => ({ invoice_id: inv.id, product_id: l.product_id || null, description: l.description, quantity: l.quantity || 1, unit_price_cents: l.unit_price_cents, sort_order: i }));
    if (lines.length) await rest("bill_invoice_lines", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(lines) });
    await rest(`bill_subscriptions?id=eq.${s.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ next_invoice_on: nextDate(s.next_invoice_on, s.interval) }) });

    let sent = false;
    if (s.auto_send) {
      const [fresh, seller, cust, biz, lineRows] = await Promise.all([
        rest<InvoiceRow[]>(`bill_invoices?id=eq.${inv.id}&select=*`),
        rest<Seller[]>(`acct_entities?id=eq.${s.entity_id}&select=legal_name,billing_profile`),
        rest<{ name: string; email: string | null }[]>(`bill_customers?id=eq.${s.customer_id}&select=name,email`),
        s.business_id ? rest<{ name: string }[]>(`office_businesses?id=eq.${s.business_id}&select=name`) : Promise.resolve([]),
        rest<LineRow[]>(`bill_invoice_lines?invoice_id=eq.${inv.id}&select=description,quantity,unit_price_cents,amount_cents&order=sort_order.asc`),
      ]);
      if (cust[0]?.email && fresh[0]) {
        await rest(`bill_invoices?id=eq.${inv.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString() }) });
        const { subject, text } = invoiceEmail({ ...fresh[0], status: "sent" }, lineRows, seller[0], cust[0].name, biz[0]?.name ?? null, "send");
        sent = await sendViaResend(cust[0].email, subject, text, seller[0].billing_profile.email);
        if (!sent) await rest(`bill_invoices?id=eq.${inv.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "draft", sent_at: null }) });
      }
    }
    if (!sent) await reminder(rest, `Recurring invoice ${inv.number} (${s.name}) is ready to send`, s.business_id);
    created.push(inv.number);
  }

  // Overdue follow-ups: due date, +7, +14, +30 days.
  const open = await rest<{ id: string; number: string; due_date: string; balance_cents: number; dunning_stage: number; business_id: string | null; bill_customers: { name: string } | null }[]>(
    `bill_invoices?kind=eq.invoice&status=in.(sent,partial)&due_date=lte.${today}&select=id,number,due_date,balance_cents,dunning_stage,business_id,bill_customers(name)&limit=200`,
  );
  let followUps = 0;
  for (const i of open) {
    const days = Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${i.due_date}T12:00:00Z`)) / 86_400_000);
    const stage = days >= 30 ? 4 : days >= 14 ? 3 : days >= 7 ? 2 : 1;
    if (stage <= i.dunning_stage || i.balance_cents <= 0) continue;
    const who = i.bill_customers?.name || "customer";
    await reminder(rest, days === 0
      ? `Invoice ${i.number} for ${who} is due today (${money(i.balance_cents)})`
      : `Invoice ${i.number} for ${who} is ${days} days overdue (${money(i.balance_cents)}): send a reminder from Billing`, i.business_id);
    await rest(`bill_invoices?id=eq.${i.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ dunning_stage: stage }) });
    followUps++;
  }
  return { recurringCreated: created, followUps };
}
