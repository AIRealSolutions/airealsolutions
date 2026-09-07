"use client";

import {useEffect,useMemo,useState} from "react";
import styles from "./dashboard.module.css";

const SUPABASE_URL="https://xqdsmbyealtammgmpsqe.supabase.co";
const SUPABASE_KEY="sb_publishable_78q5LVudkA7u2hqsecLmAw_br2XlkUB";
const SESSION_KEY="airealsolutions.factory.session.v1";

type Session={access_token:string;refresh_token?:string;expires_in?:number;expires_at?:number;user:{id:string;email?:string}};
type Project={id:string;slug:string;name:string;industry:string|null;summary:string|null;stage:string;progress:number;project_type:string;infrastructure_mode:string;next_action:string|null;automation_summary:string|null;updated_at:string};
type Economics={project_id:string;monthly_recurring_revenue:number;other_monthly_revenue:number;target_customer_monthly_price:number;target_customers:number;monthly_infrastructure_cost:number;monthly_ai_api_cost:number;monthly_support_cost:number;estimated_build_cost:number;actual_build_cost:number;discovery_revenue:number;implementation_revenue:number;target_setup_price:number;economic_status:string;pricing_model:string};

type Counts=Record<string,number>;

async function authRequest(path:string,body:unknown){
  const response=await fetch(`${SUPABASE_URL}/auth/v1/${path}`,{method:"POST",headers:{apikey:SUPABASE_KEY,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data?.message||data?.msg||"Session refresh failed.");return data;
}
async function fetchUser(token:string){const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${token}`}});const d=await r.json().catch(()=>({}));if(!r.ok||!d?.id)throw new Error("Session expired.");return d;}
function saveSession(session:Session){const expiresAt=session.expires_at||Math.floor(Date.now()/1000)+(session.expires_in||3600);localStorage.setItem(SESSION_KEY,JSON.stringify({...session,expires_at:expiresAt}));}
async function getSession():Promise<Session|null>{
  const raw=localStorage.getItem(SESSION_KEY);if(!raw)return null;let session=JSON.parse(raw) as Session;
  try{const user=await fetchUser(session.access_token);session={...session,user};saveSession(session);return session;}catch{}
  if(!session.refresh_token){localStorage.removeItem(SESSION_KEY);return null;}
  try{const refreshed=await authRequest("token?grant_type=refresh_token",{refresh_token:session.refresh_token}) as Session;if(!refreshed.access_token)return null;saveSession(refreshed);return refreshed;}catch{localStorage.removeItem(SESSION_KEY);return null;}
}
async function rest(path:string,session:Session){const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${session.access_token}`},cache:"no-store"});const d=await r.json().catch(()=>null);if(!r.ok)throw new Error(d?.message||`Factory request failed (${r.status}).`);return d;}
function title(v:string){return (v||"").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase())}
function money(v:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(v||0)}

export default function MyFactoryDashboard(){
  const[session,setSession]=useState<Session|null>(null);const[projects,setProjects]=useState<Project[]>([]);const[economics,setEconomics]=useState<Economics[]>([]);const[features,setFeatures]=useState<Counts>({});const[automations,setAutomations]=useState<Counts>({});const[loading,setLoading]=useState(true);const[error,setError]=useState("");
  useEffect(()=>{void load()},[]);
  async function load(){setLoading(true);setError("");try{const s=await getSession();if(!s){window.location.assign("/login");return}setSession(s);const[p,e,f,a]=await Promise.all([
    rest("factory_projects?select=id,slug,name,industry,summary,stage,progress,project_type,infrastructure_mode,next_action,automation_summary,updated_at&order=updated_at.desc",s),
    rest("factory_project_economics?select=project_id,monthly_recurring_revenue,other_monthly_revenue,target_customer_monthly_price,target_customers,monthly_infrastructure_cost,monthly_ai_api_cost,monthly_support_cost,estimated_build_cost,actual_build_cost,discovery_revenue,implementation_revenue,target_setup_price,economic_status,pricing_model",s),
    rest("factory_features?select=project_id",s),rest("factory_automations?select=project_id",s)
  ]);setProjects(Array.isArray(p)?p:[]);setEconomics(Array.isArray(e)?e:[]);setFeatures(countBy(f));setAutomations(countBy(a));}catch(e){setError(e instanceof Error?e.message:"Could not load My Factory.")}finally{setLoading(false)}}
  function countBy(rows:any):Counts{const out:Counts={};if(Array.isArray(rows))for(const row of rows)out[row.project_id]=(out[row.project_id]||0)+1;return out}
  function signOut(){localStorage.removeItem(SESSION_KEY);window.location.assign("/login")}
  const totals=useMemo(()=>{let mrr=0,cost=0,investment=0,upfront=0;for(const e of economics){mrr+=(e.monthly_recurring_revenue||0)+(e.other_monthly_revenue||0)+(e.target_customer_monthly_price||0)*(e.target_customers||0);cost+=(e.monthly_infrastructure_cost||0)+(e.monthly_ai_api_cost||0)+(e.monthly_support_cost||0);investment+=e.actual_build_cost||e.estimated_build_cost||0;upfront+=(e.discovery_revenue||0)+(e.implementation_revenue||0)+(e.target_setup_price||0)*(e.target_customers||0)}return{mrr,cost,investment,upfront}},[economics]);
  const economicsFor=(id:string)=>economics.find(e=>e.project_id===id);
  if(loading)return <section className={styles.shell}><div className={styles.loading}>Loading your Factory…</div></section>;
  if(error)return <section className={styles.shell}><div className={styles.error}><h1>My Factory</h1><p>{error}</p><button className="button button-primary" onClick={load}>Try again</button></div></section>;
  return <section className={styles.shell}>
    <div className={styles.hero}><div><span className="product-tag">Private owner dashboard</span><h1>My <span>Factory.</span></h1><p>Operate the portfolio from one place: economics, architecture, features, automations and the next decision for every project.</p></div><div className={styles.account}><small>Signed in as</small><strong>{session?.user?.email}</strong><button type="button" onClick={signOut}>Sign out</button></div></div>
    <div className={styles.metrics}><article><small>Projects</small><strong>{projects.length}</strong></article><article><small>Target / current monthly revenue</small><strong>{money(totals.mrr)}</strong></article><article><small>Monthly operating cost</small><strong>{money(totals.cost)}</strong></article><article><small>Recorded build investment</small><strong>{money(totals.investment)}</strong></article><article><small>Upfront revenue model</small><strong>{money(totals.upfront)}</strong></article></div>
    <div className={styles.toolbar}><div><h2>Your projects</h2><p>Only projects permitted by your Factory membership are returned.</p></div><a className="button button-primary" href="/build">+ New Project</a></div>
    <div className={styles.projects}>{projects.map(p=>{const e=economicsFor(p.id);const monthlyRevenue=e?(e.monthly_recurring_revenue||0)+(e.other_monthly_revenue||0)+(e.target_customer_monthly_price||0)*(e.target_customers||0):0;const monthlyCost=e?(e.monthly_infrastructure_cost||0)+(e.monthly_ai_api_cost||0)+(e.monthly_support_cost||0):0;return <article className={styles.project} key={p.id}><div className={styles.projectTop}><div><span className="product-tag">{title(p.project_type)}</span><h3>{p.name}</h3><p>{p.summary||p.industry||"Factory project"}</p></div><div className={styles.progress}><strong>{p.progress}%</strong><span>{title(p.stage)}</span><i><b style={{width:`${p.progress}%`}}/></i></div></div><div className={styles.projectStats}><span><small>Features</small><strong>{features[p.id]||0}</strong></span><span><small>Automations</small><strong>{automations[p.id]||0}</strong></span><span><small>Monthly revenue</small><strong>{money(monthlyRevenue)}</strong></span><span><small>Monthly cost</small><strong>{money(monthlyCost)}</strong></span><span><small>Economics</small><strong>{e?title(e.economic_status):"Not set"}</strong></span></div><div className={styles.next}><span><small>Next Factory action</small><strong>{p.next_action||"Define the next gate"}</strong></span><span className={styles.actions}><a href={`/factory/projects/${p.slug}#economics`}>Economics</a><a className={styles.open} href={`/factory/projects/${p.slug}`}>Open Workspace →</a></span></div></article>})}</div>
    {!projects.length&&<div className={styles.empty}><h3>No projects are available to this account.</h3><p>If you expected projects here, the organization membership needs to be checked.</p></div>}
  </section>
}
