const stages=["Discovery","Architecture","Prototype","Testing","Production"];
const supabaseUrl="https://xqdsmbyealtammgmpsqe.supabase.co";
const publishableKey="sb_publishable_78q5LVudkA7u2hqsecLmAw_br2XlkUB";

type FactoryProject={
  slug:string;name:string;industry:string|null;summary:string|null;stage:string;
  infrastructure_mode:string;project_type:string;repository_url:string|null;product_url:string|null;
  next_action:string|null;automation_summary:string|null;progress:number;
};

const titleCase=(value:string)=>value.split("_").map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join(" ");

async function getProjects():Promise<FactoryProject[]>{
  try{
    const select="slug,name,industry,summary,stage,infrastructure_mode,project_type,repository_url,product_url,next_action,automation_summary,progress";
    const response=await fetch(`${supabaseUrl}/rest/v1/factory_public_projects?select=${select}&order=project_type.asc,name.asc`,{
      headers:{apikey:publishableKey,Authorization:`Bearer ${publishableKey}`},
      next:{revalidate:60}
    });
    if(!response.ok) throw new Error(`Factory registry request failed: ${response.status}`);
    return await response.json() as FactoryProject[];
  }catch(error){
    console.error("Factory portfolio unavailable",error);
    return [];
  }
}

export const metadata={title:"Software Factory | AI Real Solutions",description:"AI Real Solutions' working software and automation portfolio, managed from discovery through production."};

export default async function FactoryPage(){
  const projects=await getProjects();
  const counts={
    core:projects.filter(p=>p.project_type==="core_factory").length,
    ventures:projects.filter(p=>p.project_type==="internal_venture").length,
    graduated:projects.filter(p=>p.project_type==="graduated_product").length
  };
  return <main>
    <header className="site-header"><a className="brand" href="/"><span className="brand-mark">AI</span><span>Real Solutions</span></a><nav><a href="/services">Services</a><a href="/products">Products</a><a href="/about">About</a><a className="nav-cta" href="/build">Start a Build</a></nav></header>
    <section className="page-hero factory-hero"><p className="eyebrow">Software + Automation Factory</p><h1>Real products. <span>One repeatable factory.</span></h1><p>The Factory remains the operating system. Internal ventures, client builds and graduated products move through the same discovery, architecture, automation, testing and production discipline without merging their product codebases.</p></section>
    <section className="section factory-workspace"><div className="factory-toolbar"><div><span className="product-tag">Live Supabase registry</span><h2>AI Real Solutions projects</h2><p>{counts.core} core factory · {counts.ventures} internal ventures · {counts.graduated} graduated product</p></div><a className="button button-primary" href="/build">+ New Project</a></div>
      <div className="pipeline">{stages.map((s,i)=><div key={s}><span>0{i+1}</span><strong>{s}</strong></div>)}</div>
      <div className="project-list">{projects.length?projects.map(p=><a className="factory-project" href={`/factory/projects/${p.slug}`} key={p.slug}><div className="project-main"><span className="product-tag">{titleCase(p.project_type)}</span><h3>{p.name}</h3><p>{p.summary}</p><p><strong>Next:</strong> {p.next_action||"Define next Factory gate"}</p>{p.automation_summary&&<small>Automation: {p.automation_summary}</small>}</div><div className="project-status"><span>{titleCase(p.stage)}</span><strong>{p.progress}%</strong><div className="mini-progress"><i style={{width:`${p.progress}%`}}/></div></div><div className="project-infra"><small>Infrastructure</small><strong>{titleCase(p.infrastructure_mode)}</strong><small>Open workspace →</small></div></a>):<div className="factory-project"><div className="project-main"><span className="product-tag">Registry unavailable</span><h3>Factory data could not be loaded.</h3><p>The portfolio is protected by a read-only public projection and will return when the data service is available.</p></div></div>}</div>
    </section>
    <section className="section architecture-section"><div className="section-heading"><p className="eyebrow">Portfolio architecture</p><h2>The Factory manages products. It does not swallow them.</h2><p>Each venture can keep its own repository, deployment and eventual database while the Factory owns discovery, build briefs, architecture decisions, automation maps, milestones, approvals and operating history.</p></div><div className="architecture-grid"><div><span>01</span><strong>Core Factory</strong><p>The shared system that creates and manages software work.</p></div><div><span>02</span><strong>Internal Venture</strong><p>An AI Real Solutions product being developed through the Factory.</p></div><div><span>03</span><strong>Client Build</strong><p>Customer software isolated by organization and project permissions.</p></div><div><span>04</span><strong>Graduated Product</strong><p>A mature system with dedicated infrastructure that still reports back to the Factory.</p></div></div></section>
    <section className="cta-section"><div><p className="eyebrow">Factory principle</p><h2>Build reusable capability, not a pile of unrelated apps.</h2><p>Every real project should improve the Factory's templates, automation library, architecture patterns and delivery process.</p></div><a className="button button-light" href="/build">Start Discovery</a></section>
  </main>;
}
