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
    text: "A concept for AI-assisted government and committee workflows, records, agendas, routine tasks, and public information.",
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
        <a className="brand" href="#top" aria-label="AI Real Solutions home">
          <span className="brand-mark">AI</span>
          <span>Real Solutions</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#services">Services</a>
          <a href="#products">Products</a>
          <a href="#approach">Approach</a>
          <a className="nav-cta" href="#contact">Start a Project</a>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">AI-assisted business & civic technology</p>
          <h1>Real problems deserve <span>real solutions.</span></h1>
          <p className="hero-text">
            AI Real Solutions designs practical software, automations, digital workflows,
            and communication systems for businesses, local governments, campaigns, and
            community organizations.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#contact">Discuss a Project</a>
            <a className="button button-secondary" href="#products">See What We’re Building</a>
          </div>
          <div className="hero-proof">
            <div><strong>Practical</strong><span>Built around actual work</span></div>
            <div><strong>Focused</strong><span>Technology with a clear purpose</span></div>
            <div><strong>Adaptable</strong><span>Solutions that can grow</span></div>
          </div>
        </div>
        <div className="hero-panel" aria-label="AI Real Solutions capabilities">
          <p className="panel-kicker">From idea to working system</p>
          <div className="flow-step"><span>01</span><div><strong>Find the friction</strong><p>Identify wasted time, repeated work, and communication gaps.</p></div></div>
          <div className="flow-step"><span>02</span><div><strong>Design the workflow</strong><p>Choose the simplest combination of people, software, data, and AI.</p></div></div>
          <div className="flow-step"><span>03</span><div><strong>Build the solution</strong><p>Create the application, automation, website, or operating process.</p></div></div>
          <div className="flow-step"><span>04</span><div><strong>Improve with use</strong><p>Measure what works, refine the system, and expand only where useful.</p></div></div>
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
            <h2>We build our own tools, too.</h2>
          </div>
          <p>These projects show the kind of focused, industry-specific systems AI Real Solutions is developing across government, real estate, elections, heritage, and production businesses.</p>
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
          <h2>AI should simplify the work, not become another job to manage.</h2>
        </div>
        <div className="approach-copy">
          <p>
            The best AI implementation often begins with a very ordinary question: what is taking too long, being done twice, getting lost between people, or preventing someone from serving a customer or citizen well?
          </p>
          <p>
            We start there. Then we build only what earns its place in the workflow. Sometimes that is an AI agent. Sometimes it is a better database, a simpler website, a dashboard, a communication system, or an automation connecting tools that already exist.
          </p>
        </div>
      </section>

      <section className="cta-section" id="contact">
        <div>
          <p className="eyebrow">Start with the problem</p>
          <h2>Have a process that should work better?</h2>
          <p>Tell us what is slowing you down, what you are trying to build, or what your organization needs to make easier.</p>
        </div>
        <a className="button button-light" href="mailto:marcspencer28461@gmail.com">Start the Conversation</a>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark">AI</span><span>Real Solutions</span></div>
        <p>Practical AI, automation, software, and digital strategy for real-world work.</p>
        <span>© {new Date().getFullYear()} AI Real Solutions</span>
      </footer>
    </main>
  );
}
