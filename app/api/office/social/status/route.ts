// Which publishing channels the server is set up for. No secrets are returned.
import { metaConfigured, youtubeConfigured } from "../../../../lib/office/social";

export function GET() {
  return Response.json({ youtube: youtubeConfigured(), meta: metaConfigured() });
}
