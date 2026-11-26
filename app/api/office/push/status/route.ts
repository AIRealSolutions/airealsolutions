// Which notification channels the server is set up for. Returns the public VAPID key (public by design), no secrets.
import { pushConfigured, smsConfigured, vapidPublicKey } from "../../../../lib/office/notify";

export function GET() {
  return Response.json({ push: pushConfigured(), publicKey: pushConfigured() ? vapidPublicKey() : null, sms: smsConfigured() });
}
