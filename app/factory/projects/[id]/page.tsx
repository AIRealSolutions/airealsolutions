import ArchitecturePanel from "./ArchitecturePanel";
import styles from "./workspace.module.css";

const SUPABASE_URL="https://xqdsmbyealtammgmpsqe.supabase.co";
const SUPABASE_KEY="sb_publishable_78q5LVudkA7u2hqsecLmAw_br2XlkUB";
const tabs=["Overview","Build Brief","Architecture","Features","Automations","Data","Integrations","Prototype","Activity"];

export const metadata={title:"Project Workspace | AI Real Solutions"};

async function getPublicProject(slug:string){
  try{
    const response=await fetch(`${SUPABASE_URL}/rest/v1/factory_public_projects?slug=eq.${encodeURIComponent(slug)}&select=slug,name,summary,stage,progress,infrastructure_mode,project_type,next_action,automation_summary&limit=1`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`},next:{revalidate:60}});
    if(!response.ok)return null;
    const rows=await response.json();
    return Array.isArray(rows)?rows[0]||null:null;
  }catch{return null}
}

function label(value:string|undefined){return (value||"").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase())}

export default async function ProjectWorkspace({params}:{params:Promise<{id:string}>}){
  const{id}=await params;
  const project=await getPublicProject(id);
  const name=project?.name||id;
  const stage=label(project?.stage)||"Discovery";
  const infrastructure=label(project?.infrastructure_mode)||"Shared Factory";
  const next=project?.next_action||"Capture discovery and generate architecture";
  return <main>
    <header className="site-header"><a className="brand" href="/"><span className="brand-mark">AI</span><span>Real Solutions</span></a><nav><a href="/factory">Factory</a><a href="/products">Products</a><a className="nav-cta" href="/build">New Project</a></nav></header>
    <section className="page-hero factory-hero"><p className="eyebrow">Factory Project / {label(project?.project_type)||"Project"}</p><h1>{name} <span>workspace.</span></h1><p>{project?.summary||"One operating record for discovery, product architecture, automations, prototype work, approvals, and production history."}</p></section>
    <section className="section factory-workspace">
      <div className={styles.tabs}>{tabs.map((t,i)=><a href={t==="Architecture"?"#architecture":"#overview"} key={t} className={i===0?styles.active:""}>{t}</a>)}</div>
      <div className={styles.summary} id="overview"><article><span className="product-tag">Stage</span><strong>{stage}</strong><p>{project?.progress??0}% through the current Factory lifecycle.</p></article><article><span className="product-tag">Infrastructure</span><strong>{infrastructure}</strong><p>Products can remain in the shared incubator until security, scale or maturity justify graduation.</p></article><article><span className="product-tag">Next Gate</span><strong>Architecture Review</strong><p>{next}</p></article></div>
      <div className={styles.columns}><section className={styles.panel}><span className="product-tag">Product specification</span><h2>What the Factory produces</h2><div className={styles.checks}><div><b>01</b><span><strong>Build Brief</strong><small>Problem, users, outcome, requirements and constraints.</small></span></div><div><b>02</b><span><strong>Application Map</strong><small>Screens, roles, permissions, workflows and data.</small></span></div><div><b>03</b><span><strong>Automation Map</strong><small>Triggers, conditions, actions, approvals and exceptions.</small></span></div><div><b>04</b><span><strong>Prototype Plan</strong><small>Smallest useful version, test criteria and launch gate.</small></span></div></div></section><section className={`${styles.panel} ${styles.automation}`}><span className="product-tag">Automation direction</span><h2>Work the system can perform</h2><p>{project?.automation_summary||"Automation candidates are generated from the discovery intake and refined during architecture review."}</p><div className={styles.automationRow}><strong>Factory rule</strong><small><b>Trigger:</b> Events, schedules, incoming data, or status changes</small><small><b>Action:</b> Evaluate → act → log → notify</small><small><b>Human control:</b> Required for consequential approvals and exceptions</small></div></section></div>
      <ArchitecturePanel projectSlug={id}/>
    </section>
  </main>
}
