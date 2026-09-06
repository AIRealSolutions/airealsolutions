import ProjectBuilder from "./ProjectBuilder";

export const metadata = {
  title: "Build Your Software | AI Real Solutions",
  description: "Turn a business problem or software idea into a structured, build-ready brief with AI Real Solutions.",
};

export default function BuildPage() {
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

      <section className="page-hero factory-hero">
        <p className="eyebrow">AI Real Solutions Software Factory</p>
        <h1>Describe the problem. <span>We structure the build.</span></h1>
        <p className="hero-text">
          Great software starts with better questions. This guided intake converts what you know about your business into the requirements a development team needs to design the right system.
        </p>
      </section>

      <section className="section builder-section">
        <ProjectBuilder />
      </section>

      <section className="cta-section">
        <div>
          <p className="eyebrow">From prompt to product</p>
          <h2>The goal is not just to generate code. It is to manufacture useful software repeatedly.</h2>
          <p>AI Real Solutions is building a reusable process for discovery, prototyping, data architecture, deployment, testing, and ongoing improvement.</p>
        </div>
        <a className="button button-light" href="/contact">Talk With Us</a>
      </section>
    </main>
  );
}
