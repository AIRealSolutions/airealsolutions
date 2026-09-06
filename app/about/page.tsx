export const metadata = {
  title: "About | AI Real Solutions",
  description:
    "AI Real Solutions builds practical AI-assisted software, automations, civic technology, and communication systems around real operational needs.",
};

export default function AboutPage() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/" aria-label="AI Real Solutions home"><span className="brand-mark">AI</span><span>Real Solutions</span></a>
        <nav aria-label="Primary navigation">
          <a href="/services">Services</a><a href="/products">Products</a><a href="/about">About</a><a className="nav-cta" href="/contact">Start a Project</a>
        </nav>
      </header>

      <section className="page-hero">
        <p className="eyebrow">About AI Real Solutions</p>
        <h1>Technology should serve the work.</h1>
        <p>AI Real Solutions exists to turn practical experience into better systems—software, automations, websites, data tools, and communication workflows that make organizations more effective.</p>
      </section>

      <section className="section approach">
        <div>
          <p className="eyebrow">How we think</p>
          <h2>Start with the friction, not the technology.</h2>
        </div>
        <div className="approach-copy">
          <p>We look for the place where time is being lost, work is being repeated, information is hard to find, or communication is breaking down. Only then do we decide what technology belongs in the solution.</p>
          <p>That might mean an AI agent, but it might also mean a better database, a clean workflow, a focused application, or simply connecting existing tools in a smarter way.</p>
        </div>
      </section>

      <section className="section">
        <div className="principle-grid">
          <article className="principle-card"><h3>Practical first</h3><p>The system has to work for the people actually using it.</p></article>
          <article className="principle-card"><h3>Human judgment stays important</h3><p>AI should improve decisions and execution, not remove accountability.</p></article>
          <article className="principle-card"><h3>Build for adoption</h3><p>A useful tool is understandable, maintainable, and easy to fit into daily work.</p></article>
          <article className="principle-card"><h3>Improve with use</h3><p>We prefer systems that can learn from real operating experience and evolve over time.</p></article>
        </div>
      </section>
    </main>
  );
}
