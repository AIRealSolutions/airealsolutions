// Public: start a Stripe Checkout for an invoice's open balance, then redirect to Stripe.
// The unguessable token in the URL is the only key; the amount always comes from the database.
import { createCheckout, payLink } from "../../../../lib/office/billing";
import { HttpError } from "../../../../lib/integrations/server";
import { loadPublicInvoice } from "../../../../lib/office/pay";
import { asService } from "../../../../lib/office/server";

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const inv = await loadPublicInvoice(token);
    if (!inv) return new Response("Invoice not found.", { status: 404 });
    const label = inv.office_businesses?.name || inv.acct_entities?.legal_name || "AI Real Solutions";
    const session = await createCheckout(inv, inv.bill_customers?.email ?? null, label);
    await asService()(`bill_invoices?id=eq.${inv.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ stripe_session_id: session.id }) });
    return Response.redirect(session.url, 303);
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : "Online payment is not available right now.";
    if (!(e instanceof HttpError)) console.error("[pay] checkout failed", e);
    return Response.redirect(`${payLink(token)}?error=${encodeURIComponent(msg)}`, 303);
  }
}
