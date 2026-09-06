export const metadata = {
  title: "Products | AI Real Solutions",
  description:
    "Explore AI Real Solutions products in civic technology, public policy, elections, heritage, production software, and real estate.",
};

const products = [
  { name: "VirtualClerk.ai", tag: "Municipal Workflow", text: "AI-assisted workflows for government, committees, records, agendas, routine administrative work, and public information.", url: "https://virtualclerk.ai" },
  { name: "NCIssues.com", tag: "Public Policy", text: "A platform for organizing and tracking North Carolina legislative, policy, and public-interest information.", url: "https://ncissues.com" },
  { name: "ElectionAgents.com", tag: "Campaign Technology", text: "Campaign operations, outreach, communication, digital activity, events, and fundraising workflows built around an agent-assisted model.", url: "https://electionagents.com" },
  { name: "CemeteryBuilder.ai", tag: "Digital Heritage", text: "Cemetery records, mapping, memorial information, and digital heritage tools for communities and cemetery operators.", url: "https://cemeterybuilder.ai" },
  { name: "SignForge", tag: "Production Software", text: "A production operating system for signs, apparel, promotional products, quoting, approvals, workflow, and equipment integration.", url: "https://github.com/AIRealSolutions/SignForge" },
  { name: "USA HUD Homes", tag: "Real Estate Technology", text: "A buyer-focused platform for HUD-owned homes, education, alerts, property discovery, and lead generation.", url: "https://usahudhomes.com" },
];

export default function ProductsPage() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/" aria-label="AI Real Solutions home"><span className="brand-mark">AI</span><span>Real Solutions</span></a>
        <nav aria-label="Primary navigation">
          <a href="/services">Services</a><a href="/products">Products</a><a href="/about">About</a><a className="nav-cta" href="/contact">Start a Project</a>
        </nav>
      </header>

      <section className="page-hero">
        <p className="eyebrow">Product Studio</p>
        <h1>Focused tools for specific industries and public needs.</h1>
        <p>We build our own products to solve problems we understand firsthand. That work also improves how we approach client projects.</p>
      </section>

      <section className="section">
        <div className="detail-grid">
          {products.map((product) => (
            <article className="detail-card" key={product.name}>
              <span className="product-tag">{product.tag}</span>
              <h2>{product.name}</h2>
              <p>{product.text}</p>
              <a className="text-link" href={product.url} target="_blank" rel="noreferrer">Explore project →</a>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
