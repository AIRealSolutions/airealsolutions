export const metadata = {
  title: "Services | AI Real Solutions",
  description:
    "AI automation, application development, civic technology, marketing, public relations, procurement support, and workflow consulting.",
};

const services = [
  {
    title: "Business Automation",
    body: "We map repetitive work, approvals, handoffs, notifications, intake, and follow-up, then build practical automations that reduce manual effort without making the process harder to understand.",
    examples: ["Lead and customer follow-up", "Document and intake workflows", "Internal notifications", "Recurring reporting", "Task routing and reminders"],
  },
  {
    title: "Application Development",
    body: "We build focused web applications, dashboards, databases, and AI-assisted tools around a specific operating need instead of forcing a business into generic software.",
    examples: ["Custom dashboards", "Internal business tools", "Client portals", "Search and data tools", "Industry-specific SaaS products"],
  },
  {
    title: "Government & Civic Technology",
    body: "We create tools that help local governments, boards, committees, and community organizations organize information, reduce administrative burden, and serve the public more effectively.",
    examples: ["Agenda and committee workflows", "Public records organization", "Cemetery and heritage databases", "Constituent information tools", "Policy and legislative tracking"],
  },
  {
    title: "Marketing & Public Relations",
    body: "We combine practical communication strategy with AI-assisted content, web development, digital campaigns, and systems that help organizations communicate more consistently.",
    examples: ["Websites and landing pages", "Campaign content systems", "Email and social workflows", "Marketing collateral", "Public-facing communication"],
  },
  {
    title: "Government Relations & Procurement",
    body: "We help organizations understand public-sector processes, organize outreach, identify opportunities, and communicate with government stakeholders clearly and responsibly.",
    examples: ["Procurement research", "Opportunity tracking", "Government outreach systems", "Public-sector messaging", "Stakeholder organization"],
  },
  {
    title: "AI Workflow Consulting",
    body: "We identify where AI can create a real advantage, define the workflow, select appropriate tools, establish human review points, and build an implementation plan that can actually be maintained.",
    examples: ["AI readiness reviews", "Workflow mapping", "Agent and automation design", "Policy and guardrails", "Implementation planning"],
  },
];

export default function ServicesPage() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/" aria-label="AI Real Solutions home"><span className="brand-mark">AI</span><span>Real Solutions</span></a>
        <nav aria-label="Primary navigation">
          <a href="/services">Services</a><a href="/products">Products</a><a href="/about">About</a><a className="nav-cta" href="/contact">Start a Project</a>
        </nav>
      </header>

      <section className="page-hero">
        <p className="eyebrow">Services</p>
        <h1>Build a better way to get the work done.</h1>
        <p>AI Real Solutions combines software, automation, communication, and practical operating experience to solve specific business and civic problems.</p>
      </section>

      <section className="section">
        <div className="detail-grid">
          {services.map((service) => (
            <article className="detail-card" key={service.title}>
              <h2>{service.title}</h2>
              <p>{service.body}</p>
              <ul>{service.examples.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>

      <section className="cta-section">
        <div><p className="eyebrow">Start with the problem</p><h2>Show us the workflow that is wasting time.</h2><p>We will help determine whether the right answer is automation, a custom app, a better website, a database, or a simpler operating process.</p></div>
        <a className="button button-light" href="/contact">Discuss a Project</a>
      </section>
    </main>
  );
}
