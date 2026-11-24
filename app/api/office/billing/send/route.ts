// Email an invoice, quote or payment reminder to the customer. POST { invoice_id, mode: "send" | "reminder" } as an admin.
// Sends from the owner's connected Gmail when available, otherwise through Resend when configured.
import { sendGmail } from "../../../../lib/integrations/google";
import { errorResponse, HttpError, readJson, requireAdmin } from "../../../../lib/integrations/server";
import { invoiceEmail, payLink, sendViaResend, type InvoiceRow, type LineRow, type Seller } from "../../../../lib/office/billing";
import { asUser } from "../../../../lib/office/server";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const { invoice_id, mode } = await readJson<{ invoice_id?: string; mode?: string }>(request);
    if (!invoice_id || !/^[0-9a-f-]{36}$/i.test(invoice_id)) throw new HttpError(400, "invoice_id is required.");
    const rest = asUser(user);
    const inv = (await rest<(InvoiceRow & { bill_customers: { name: string; email: string | null } | null; office_businesses: { name: string } | null; acct_entities: Seller | null })[]>(
      `bill_invoices?id=eq.${invoice_id}&select=*,bill_customers(name,email),office_businesses(name),acct_entities(legal_name,billing_profile)&limit=1`,
    ))[0];
    if (!inv) throw new HttpError(404, "Invoice not found.");
    if (inv.status === "void") throw new HttpError(409, "This invoice is void.");
    const to = inv.bill_customers?.email;
    if (!to) throw new HttpError(400, "Add an email address to this customer first.");
    const lines = await rest<LineRow[]>(`bill_invoice_lines?invoice_id=eq.${inv.id}&select=description,quantity,unit_price_cents,amount_cents&order=sort_order.asc`);
    if (!lines.length) throw new HttpError(400, "Add at least one line first.");

    const status = inv.status === "draft" ? "sent" : inv.status;
    const { subject, text } = invoiceEmail({ ...inv, status }, lines, inv.acct_entities!, inv.bill_customers!.name, inv.office_businesses?.name ?? null, mode === "reminder" ? "reminder" : "send");

    // Open it for payment before the customer clicks the link.
    if (inv.status === "draft") await rest(`bill_invoices?id=eq.${inv.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString() }) });

    let via: "gmail" | "resend" | null = null;
    try {
      await sendGmail(user, { to, subject, text });
      via = "gmail";
    } catch (e) {
      console.error("[billing] gmail send failed, trying resend", e instanceof Error ? e.message : e);
      if (await sendViaResend(to, subject, text, inv.acct_entities?.billing_profile.email)) via = "resend";
    }
    if (!via && inv.status === "draft") {
      await rest(`bill_invoices?id=eq.${inv.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "draft", sent_at: null }) });
    }
    return Response.json({ sent: Boolean(via), via, link: payLink(inv.public_token), subject, text });
  } catch (e) {
    return errorResponse(e);
  }
}
