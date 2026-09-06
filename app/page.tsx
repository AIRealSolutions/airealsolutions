const services = [
  {
    title: "Business Automation",
    text: "Turn repetitive office work into reliable workflows that save time, reduce handoffs, and help teams focus on higher-value work.",
  },
  {
    title: "Application Development",
    text: "Build focused web applications, dashboards, databases, and AI-assisted tools around real operational problems.",
  },
  {
    title: "Government & Civic Technology",
    text: "Develop practical tools for municipalities, boards, public information, records, constituent service, and community-facing workflows.",
  },
  {
    title: "Marketing & Public Relations",
    text: "Create clearer messaging, stronger digital campaigns, content systems, websites, and communication workflows supported by AI.",
  },
  {
    title: "Government Relations & Procurement",
    text: "Support organizations that need to understand public-sector processes, communicate effectively, and pursue opportunities responsibly.",
  },
  {
    title: "AI Workflow Consulting",
    text: "Identify where AI actually fits, choose useful tools, set guardrails, and build repeatable systems instead of adding technology for its own sake.",
  },
];

const products = [
  {
    name: "VirtualClerk.ai",
    tag: "Municipal Workflow",
    text: "AI-assisted government and committee workflows, records, agendas, routine tasks, and public information.",
  },
  {
    name: "NCIssues.com",
    tag: "Public Policy",
    text: "A platform focused on organizing and tracking North Carolina legislative and public-policy information.",
  },
  {
    name: "ElectionAgents.com",
    tag: "Campaign Technology",
    text: "Tools and workflows designed to help campaigns organize communication, operations, outreach, and digital activity.",
  },
  {
    name: "CemeteryBuilder.ai",
    tag: "Digital Heritage",
    text: "Cemetery mapping, records, memorial information, and digital heritage tools for communities and cemetery operators.",
  },
  {
    name: "SignForge",
    tag: "Production Software",
    text: "A production system for signs, apparel, promotional products, quoting, approvals, workflow, and equipment integration.",
  },
  {
    name: "USA HUD Homes",
    tag: "Real Estate Technology",
    text: "A buyer-focused platform for HUD-owned homes, education, alerts, property discovery, and lead generation.",
  },
];

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/" aria-label="AI Real Solutions home">
          <span className="brand-mark">AI</span>
          <span>Real Solutions</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="/services">Services</a>
          <a href="/products">Products</a>
          <a href="/about">About</a>
          <a className="nav-cta" href="/build">Build Something</a>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">AI-assisted software factory</p>
          <h1>From business problem to <span>working software.</span></h1>
          <p className="hero-text">
            AI Real Solutions combines discovery, AI-assisted development, automation, databases, and deployment into a repeatable process for building useful software faster.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="/build">Build Your Project Brief</a>
            <a className="button button-secondary" href="/products">See What We’re Building</a>
          </div>
          <div className="hero-proof">
            <div><strong>Discover</strong><span>Define the real problem first</span></div>
            <div><strong>Prototype</strong><span>Build the smallest useful version</span></div>
            <div><strong>Scale</strong><span>Grow only after the workflow proves itself</span></div>
          </div>
        </div>
        <div className="hero-panel" aria-label="AI Real Solutions software factory process">
          <p className="panel-kicker">The software factory</p>
          <div className="flow-step"><span>01</span><div><strong>Guided intake</strong><p>Ask the questions needed to understand users, workflow, data, constraints, and outcomes.</p></div></div>
          <div className="flow-step"><span>02</span><div><strong>Build brief</strong><p>Turn answers into structured requirements that people and AI coding systems can work from.</p></div></div>
          <div className="flow-step"><span>03</span><div><strong>Prototype & test</strong><p>Build a focused version, put it in front of real users, and learn quickly.</p></div></div>
          <div className="flow-step"><span>04</span><div><strong>Production system</strong><p>Harden the data, permissions, integrations, deployment, and ongoing operating model.</p></div></div>
        </div>
      </section>

      <section className="section factory-band">
        <div className="factory-copy">
          <p className="eyebrow">Start before the sales call</p>
          <h2>Onboarding should begin building the software.</h2>
          <p>
            Instead of a generic contact form, customers can work through the same discovery questions we would ask in a project meeting. Their answers become the first version of the product specification.
          </p>
          <a className="button button-primary" href="/build">Try the Project Builder</a>
        </div>
        <div className="factory-map" aria-label="Software factory workflow">
          <div><span>1</span><strong>Problem</strong><small>What is not working?</small></div>
          <div><span>2</span><strong>Requirements</strong><small>Who, what, data, integrations?</small></div>
          <div><span>3</span><strong>Prototype</strong><small>What is the smallest useful product?</small></div>
          <div><span>4</span><strong>Operate</strong><small>Secure, measure, support, improve.</small></div>
        </div>
      </section>

      <section className="section" id="services">
        <div className="section-heading">
          <p className="eyebrow">What we do</p>
          <h2>Use AI where it creates a measurable advantage.</h2>
          <p>We combine software development, automation, communication, and practical operating experience to solve specific problems.</p>
        </div>
        <div className="card-grid">
          {services.map((service, index) => (
            <article className="service-card" key={service.title}>
              <span className="card-number">0{index + 1}</span>
              <h3>{service.title}</h3>
              <p>{service.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section product-section" id="products">
        <div className="section-heading split-heading">
          <div>
            <p className="eyebrow">Product studio</p>
            <h2>Our own projects prove the process.</h2>
          </div>
          <p>These products give AI Real Solutions a growing library of reusable patterns for government, real estate, campaigns, heritage, production businesses, and workflow automation.</p>
        </div>
        <div className="product-grid">
          {products.map((product) => (
            <article className="product-card" key={product.name}>
              <span className="product-tag">{product.tag}</span>
              <h3>{product.name}</h3>
              <p>{product.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section approach" id="approach">
        <div>
          <p className="eyebrow">Our approach</p>
          <h2>Build reusable capability, not one-off code.</h2>
        </div>
        <div className="approach-copy">
          <p>
            Every project should make the next project easier. Authentication, permissions, onboarding, dashboards, notifications, document handling, search, billing, AI workflows, and deployment can become reusable building blocks.
          </p>
          <p>
            The result is a software factory: a disciplined way to move from an operational problem to a tested product without reinventing the entire foundation each time.
          </p>
        </div>
      </section>

      <section className="cta-section" id="contact">
        <div>
          <p className="eyebrow">Start with the problem</p>
          <h2>Have something that should work better?</h2>
          <p>Use the guided intake to turn the idea into a structured brief, then we can decide whether it needs automation, a custom application, AI, or a simpler solution.</p>
        </div>
        <a className="button button-light" href="/build">Start Building</a>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark">AI</span><span>Real Solutions</span></div>
        <p>Making real solutions for modern business objectives using AI tools.</p>
        <span>© {new Date().getFullYear()} AI Real Solutions</span>
      </footer>
    </main>
  );
}
