// Section outlines for the Incubator's documents. Shared by the AI drafter (server) and the editor (browser).
export type DocKind = "business_plan" | "marketing_plan" | "license_offer";
export type DocSection = { key: string; title: string; guide: string };

export const DOC_LABEL: Record<DocKind, string> = { business_plan: "Business plan", marketing_plan: "Marketing plan", license_offer: "Licensing & sale offer" };

export const DOC_SECTIONS: Record<DocKind, DocSection[]> = {
  business_plan: [
    { key: "summary", title: "Executive summary", guide: "What the product is, who buys it, why now, and the ask (license or sale) in one paragraph." },
    { key: "problem", title: "Problem", guide: "The pain in the customer's words and what it costs them today." },
    { key: "solution", title: "Solution & product", guide: "What the product does, its key features, and how AI is used. What is built vs still to build." },
    { key: "customers", title: "Target customers", guide: "Specific customer segments and the buyer/decision-maker in each." },
    { key: "market", title: "Market", guide: "Size and shape of the market (with how it was estimated; mark estimates as estimates), especially in North Carolina and the US." },
    { key: "competition", title: "Competition & advantage", guide: "Alternatives customers use today and why this product wins." },
    { key: "business_model", title: "Business model", guide: "How it makes money: SaaS subscription, white-label license, source license, setup fees, services." },
    { key: "go_to_market", title: "Go-to-market summary", guide: "How the first 10 customers or licensees will be won (details live in the marketing plan)." },
    { key: "operations", title: "Operations & support", guide: "Hosting, onboarding, support, updates, and who does what (one owner plus AI agents and contractors)." },
    { key: "financials", title: "Financials", guide: "Pricing, cost to serve, margins, revenue so far and 12-month targets. Use the real numbers provided; label assumptions." },
    { key: "risks", title: "Risks & mitigations", guide: "Product, legal, market and dependency risks, each with a mitigation." },
    { key: "milestones", title: "Milestones", guide: "The next 3-6 milestones to being sellable, with rough timing." },
  ],
  marketing_plan: [
    { key: "positioning", title: "Positioning", guide: "One-sentence positioning statement and the category the product competes in." },
    { key: "audiences", title: "Audiences & personas", guide: "2-3 buyer personas with their goals, objections and where they spend time." },
    { key: "messaging", title: "Key messages", guide: "Headline, 3 proof-backed benefit messages, and answers to the top objections." },
    { key: "offer", title: "Offer & pricing presentation", guide: "How the offer is packaged for buyers (trial, pilot, tiers, license options)." },
    { key: "channels", title: "Channels", guide: "The few channels that fit this buyer (e.g. associations, direct outreach, LinkedIn, YouTube, events, partners), with why." },
    { key: "content", title: "Content plan", guide: "Recurring content: posts, reels/shorts, YouTube videos, case studies, emails; topics and cadence." },
    { key: "launch", title: "Launch plan", guide: "Step-by-step launch or relaunch sequence." },
    { key: "partnerships", title: "Partnerships & resellers", guide: "Partners who could resell or license it, and what they'd get." },
    { key: "budget", title: "Budget", guide: "A lean monthly budget by channel; realistic for a one-owner company." },
    { key: "metrics", title: "Metrics", guide: "Leading and lagging KPIs and targets." },
    { key: "ninety_days", title: "First 90 days", guide: "A week-by-week or month-by-month action list. These become tasks." },
  ],
  license_offer: [
    { key: "offering", title: "What is for sale", guide: "The product, code, brand, customers and data that are part of the offer, and what is excluded." },
    { key: "sale_models", title: "Ways to buy", guide: "Which models apply (SaaS subscription, white-label license, source-code license, exclusive license, outright acquisition) and who each fits." },
    { key: "pricing", title: "Pricing", guide: "Prices or price ranges for each model (setup, monthly/annual fees, revenue share), with the reasoning. Label estimates." },
    { key: "included", title: "What's included", guide: "Deliverables, onboarding, support, updates, hosting, training." },
    { key: "terms", title: "License terms outline", guide: "Scope, territory, exclusivity, term and renewal, IP ownership, warranties, liability cap, termination. State that an attorney must review the final agreement." },
    { key: "buyers", title: "Ideal buyers & licensees", guide: "Types of companies that would license or acquire it, and why." },
    { key: "valuation", title: "Valuation basis", guide: "How an asking price would be justified (revenue, cost to rebuild, comparables). Use real numbers given; label estimates." },
    { key: "next_steps", title: "Before it can be offered", guide: "What still has to be true before this offer can go to buyers." },
  ],
};
