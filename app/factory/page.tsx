const stages = ["Discovery", "Architecture", "Prototype", "Testing", "Production"];

const projects = [
  { name: "Municipal Workflow Assistant", type: "Government", stage: "Architecture", progress: 36, mode: "Shared factory", next: "Define roles and approval workflow" },
  { name: "Real Estate Buyer Funnel", type: "Real Estate", stage: "Prototype", progress: 58, mode: "Shared factory", next: "Test lead intake and alerts" },
  { name: "Production Shop System", type: "Business", stage: "Discovery", progress: 22, mode: "Shared factory", next: "Map order-to-production workflow" },
];

export const metadata = { title: "Software Factory | AI Real Solutions", description: "A working model for moving software projects from discovery through production." };

export default function FactoryPage() {
  return <main>
    <header className="site-header"><a className="brand" href="/"><span className="brand-mark">AI</span><span>Real Solutions</span></a><nav><a href="/services">Services</a><a href="/products">Products</a><a href="/about">About</a><a className="nav-cta" href="/build">Start a Build</a></nav></header>
    <section className="page-hero factory-hero"><p className="eyebrow">Software Factory Workspace</p><h1>From idea to <span>operating software.</span></h1><p>This is the operating model behind AI Real Solutions: capture the problem, structure the product, prototype economically, test it, and graduate successful software into production infrastructure.</p></section>

    <section className="section factory-workspace">
      <div className="factory-toolbar"><div><span className="product-tag">Factory portfolio</span><h2>Projects in the pipeline</h2></div><a className="button button-primary" href="/build">+ New Project</a></div>
      <div className="pipeline" aria-label="Factory stages">{stages.map((s,i)=><div key={s}><span>0{i+1}</span><strong>{s}</strong></div>)}</div>
      <div className="project-list">{projects.map((p)=><article className="factory-project" key={p.name}><div className="project-main"><span className="product-tag">{p.type}</span><h3>{p.name}</h3><p>Next: {p.next}</p></div><div className="project-status"><span>{p.stage}</span><strong>{p.progress}%</strong><div className="mini-progress"><i style={{width:`${p.progress}%`}} /></div></div><div className="project-infra"><small>Infrastructure</small><strong>{p.mode}</strong><small>Graduate when scale, sensitivity, compliance, or revenue requires isolation.</small></div></article>)}</div>
    </section>

    <section className="section architecture-section"><div className="section-heading"><p className="eyebrow">Shared incubator architecture</p><h2>One factory. Many isolated projects.</h2><p>Early prototypes can share authentication, organizations, project records, build briefs, artifacts, and event history. Each record is scoped to an organization and project. Mature products can later move to dedicated infrastructure.</p></div><div className="architecture-grid"><div><span>01</span><strong>Organization</strong><p>Customer or internal venture boundary.</p></div><div><span>02</span><strong>Project</strong><p>Individual software product or prototype.</p></div><div><span>03</span><strong>RLS isolation</strong><p>Database policies restrict project data to authorized members.</p></div><div><span>04</span><strong>Graduation</strong><p>Move successful or sensitive products to their own infrastructure.</p></div></div></section>

    <section className="cta-section"><div><p className="eyebrow">Factory principle</p><h2>Spend money after the idea earns complexity.</h2><p>Keep experiments lightweight, but design the data boundaries from day one so a successful product can grow cleanly.</p></div><a className="button button-light" href="/build">Start Discovery</a></section>
  </main>;
}
