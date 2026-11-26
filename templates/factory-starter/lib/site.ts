// The site this app renders: site.json (written by the Factory), cleaned by the shared Site Spec rules.
import raw from "../site.json";
import { sanitizeSiteSpec, type SiteForm, type SitePage, type SiteSpec } from "./site-spec";

export const site: SiteSpec = sanitizeSiteSpec(raw);

export const findPage = (route: string): SitePage | undefined => site.pages.find((p) => p.route === route);
export const findForm = (key: string): SiteForm | undefined => site.forms.find((f) => f.key === key);
export const entityOf = (key: string) => site.entities.find((e) => e.key === key);

/** Demo rows from site.json show on dashboards only in prototypes (NEXT_PUBLIC_DEMO_MODE=true). */
export const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
