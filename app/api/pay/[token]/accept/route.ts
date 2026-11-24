// Public: the customer accepts a sent quote. Marks it accepted and reminds the owner to invoice it.
import { payLink } from "../../../../lib/office/billing";
import { loadPublicInvoice } from "../../../../lib/office/pay";
import { asService } from "../../../../lib/office/server";

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await loadPublicInvoice(token).catch(() => null);
  if (!inv || inv.kind !== "quote") return new Response("Quote not found.", { status: 404 });
  if (inv.status === "sent") {
    const rest = asService();
    await rest(`bill_invoices?id=eq.${inv.id}&status=eq.sent`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "accepted" }) });
    await rest("office_reminders", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ title: `Quote ${inv.number} accepted by ${inv.bill_customers?.name || "the customer"}: turn it into an invoice`, business_id: inv.business_id, remind_at: new Date().toISOString() }),
    }).catch((e) => console.error("[pay] accept reminder failed", e));
  }
  return Response.redirect(`${payLink(token)}?accepted=1`, 303);
}
