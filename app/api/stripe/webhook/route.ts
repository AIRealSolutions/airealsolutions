// Stripe webhook: records invoice payments from Checkout. Configure in Stripe → Developers → Webhooks with
// events checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed.
import { recordStripePayment, verifyStripeSignature } from "../../../lib/office/billing";
import { asService } from "../../../lib/office/server";

type Session = { id: string; amount_total: number | null; payment_status: string; payment_intent: string | null; metadata?: { invoice_id?: string } };

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook not configured.", { status: 503 });
  const body = await request.text();
  if (!verifyStripeSignature(body, request.headers.get("stripe-signature"), secret)) return new Response("Bad signature.", { status: 400 });

  let event: { type: string; data: { object: Session } };
  try { event = JSON.parse(body); } catch { return new Response("Bad payload.", { status: 400 }); }
  const s = event.data?.object;
  const invoiceId = s?.metadata?.invoice_id;
  if (!invoiceId || !/^[0-9a-f-]{36}$/i.test(invoiceId)) return Response.json({ ignored: true });

  try {
    const rest = asService();
    const paid =
      (event.type === "checkout.session.completed" && s.payment_status === "paid") ||
      event.type === "checkout.session.async_payment_succeeded";
    if (paid && s.amount_total && s.amount_total > 0) {
      await recordStripePayment(rest, invoiceId, s.amount_total, s.payment_intent || s.id);
    } else if (event.type === "checkout.session.async_payment_failed") {
      await rest("office_reminders", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ title: `A bank payment for an invoice failed (Stripe session ${s.id}). Check the invoice in Billing.`, remind_at: new Date().toISOString() }),
      });
    }
    return Response.json({ received: true });
  } catch (e) {
    console.error("[stripe] webhook handling failed", e);
    return new Response("Handler error.", { status: 500 }); // Stripe retries
  }
}
