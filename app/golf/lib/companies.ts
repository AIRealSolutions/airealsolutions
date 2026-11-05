// Companies advertised on every Golf Buddy page. Edit this list to change the banner.
export type Company = { name: string; pitch: string; url?: string; cta: string };

export const COMPANIES: Company[] = [
  {
    name: "AI Real Solutions",
    pitch: "We built this app. Custom AI tools and automation for your business.",
    url: "https://airealsolutions.com",
    cta: "Start a build",
  },
  {
    name: "Lightkeeper Realty",
    pitch: "Buying or selling in North Carolina? HUD home specialists.",
    // TODO: add the Lightkeeper Realty website when available.
    cta: "Ask Marc",
  },
  {
    name: "USA HUD Homes",
    pitch: "Find HUD-owned homes for sale, with alerts and buyer help.",
    url: "https://usahudhomes.com",
    cta: "Search HUD homes",
  },
  {
    name: "FindANCHome",
    pitch: "Homes for sale across Southeastern North Carolina.",
    url: "https://findanchome.com",
    cta: "Browse homes",
  },
  {
    name: "NCIssues.com",
    pitch: "Follow the NC General Assembly bills that affect you.",
    url: "https://ncissues.com",
    cta: "Track bills",
  },
  {
    name: "CemeteryBuilder.ai",
    pitch: "AI-built cemetery layouts, mapping and records.",
    url: "https://cemeterybuilder.ai",
    cta: "Learn more",
  },
];
