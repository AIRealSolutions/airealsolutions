export const metadata = {
  title: "Products | AI Real Solutions",
  description: "Explore AI Real Solutions software products and automation systems for business, government, real estate, production, and community organizations.",
};

const categories = [
  { name: "Automation Systems", text: "Reusable agents, triggers, approvals, notifications, document flows, scheduled work, data synchronization, and human-in-the-loop processes. Automation is a product category of its own and a capability that can be embedded into every other product." },
  { name: "Government & Civic", text: "Workflow, records, public information, policy tracking, digital heritage, and administrative systems designed around accountability and human oversight." },
  { name: "Business Operations", text: "Purpose-built operating systems that connect customers, staff, data, production, communication, and recurring work." },
  { name: "Real Estate Technology", text: "Property discovery, lead generation, buyer and seller workflows, alerts, marketing, transaction support, and specialized housing programs." },
];

const products = [
  { name: "Automation Factory", tag: "Automation Systems", text: "A modular automation layer for recurring work: monitor events, collect information, route tasks, request approvals, generate documents, send alerts, synchronize systems, and keep an auditable activity history.", url: "/build", internal: true },
  { name: "VirtualClerk.ai", tag: "Government & Civic", text: "AI-assisted workflows for government, committees, records, agendas, routine administrative work, public information, and recurring clerk automations.", url: "https://virtualclerk.ai" },
  { name: "NCIssues.com", tag: "Government & Civic", text: "A platform for organizing and tracking North Carolina legislative, policy, and public-interest information with monitoring and notification workflows.", url: "https://ncissues.com" },
  { name: "ElectionAgents.com", tag: "Campaign Technology", text: "Campaign operations, outreach, communication, digital activity, events, fundraising, scheduling, and agent-assisted campaign automations.", url: "https://electionagents.com" },
  { name: "CemeteryBuilder.ai", tag: "Digital Heritage", text: "Cemetery records, mapping, memorial information, digital heritage tools, and workflows for maintaining community records.", url: "https://cemeterybuilder.ai" },
  { name: "SignForge", tag: "Business Operations", text: "A production operating system for signs, apparel, promotional products, quoting, approvals, production workflow, notifications, and equipment integration.", url: "https://github.com/AIRealSolutions/SignForge" },
  { name: "USA HUD Homes", tag: "Real Estate Technology", text: "A buyer-focused platform for HUD-owned homes, education, alerts, property discovery, lead generation, and automated follow-up.", url: "https://usahudhomes.com" },
];

export default function ProductsPage() {
  return <main>
    <header className="site-header"><a className="brand" href="/" aria-label="AI Real Solutions home"><span className="brand-mark">AI</span><span>Real Solutions</span></a><nav aria-label="Primary navigation"><a href="/services">Services</a><a href="/products">Products</a><a href="/factory">Factory</a><a href="/about">About</a><a className="nav-cta" href="/build">Start a Build</a></nav></header>
    <section className="page-hero"><p className="eyebrow">Product Studio + Automation Factory</p><h1>Software that does the work, not just stores the information.</h1><p>AI Real Solutions builds focused software products and reusable automation systems. A product may stand alone, or the factory can combine software, AI, integrations, triggers, approvals, and scheduled workflows into a customer-specific operating system.</p></section>
    <section className="section product-category-section"><div className="section-heading"><p className="eyebrow">Product scheme</p><h2>Four connected product families.</h2><p>Automation sits beside our vertical products and also runs through them. The goal is to remove repetitive work while keeping people in control of important decisions.</p></div><div className="architecture-grid">{categories.map((c,i)=><div key={c.name}><span>0{i+1}</span><strong>{c.name}</strong><p>{c.text}</p></div>)}</div></section>
    <section className="section"><div className="section-heading"><p className="eyebrow">Current product portfolio</p><h2>Products become building blocks for the factory.</h2></div><div className="detail-grid">{products.map((product)=><article className="detail-card" key={product.name}><span className="product-tag">{product.tag}</span><h2>{product.name}</h2><p>{product.text}</p><a className="text-link" href={product.url} target={product.internal ? undefined : "_blank"} rel={product.internal ? undefined : "noreferrer"}>Explore project →</a></article>)}</div></section>
    <section className="cta-section"><div><p className="eyebrow">Build + Automate</p><h2>Start with the work that consumes your time.</h2><p>The discovery process identifies both the software you need and the recurring tasks that should be automated around it.</p></div><a className="button button-light" href="/build">Start Discovery</a></section>
  </main>;
}
