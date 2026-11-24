// What billing features are set up on this deployment (no secrets returned).
import { siteUrl, stripeConfigured } from "../../../../lib/office/billing";

export async function GET() {
  return Response.json({
    stripe: stripeConfigured(),
    webhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    resend: Boolean(process.env.RESEND_API_KEY && (process.env.OFFICE_BILLING_FROM || process.env.OFFICE_BRIEF_FROM)),
    site: siteUrl(),
  });
}
