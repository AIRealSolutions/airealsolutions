"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./ArchitecturePanel.module.css";

const SUPABASE_URL="https://xqdsmbyealtammgmpsqe.supabase.co";
const SUPABASE_KEY="sb_publishable_78q5LVudkA7u2hqsecLmAw_br2XlkUB";
const SESSION_KEY="airealsolutions.factory.session.v1";

type Session={access_token:string;user:{id:string;email?:string}};
type Architecture={
  version:number; generatedAt:string; projectName:string; summary:string;
  roles:string[]; screens:string[]; entities:string[]; workflows:string[];
  automations:{name:string;trigger:string;actions:string;approval:string}[];
  integrations:string[]; security:string[]; mvp:string[]; later:string[]; buildSequence:string[];
};

async function rest(path:string,session:Session,init:RequestInit={}){
  const response=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{...init,headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json",...(init.headers||{})}});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data?.message||data?.hint||`Factory request failed (${response.status}).`)}
  if(response.status===204)return null;
  return response.json().catch(()=>null);
}

function text(v:unknown){return typeof v==="string"?v:""}
function splitIdeas(value:string){return value.split(/[\n,;]+/).map(v=>v.trim()).filter(Boolean).slice(0,8)}
function includesAny(haystack:string,terms:string[]){const s=haystack.toLowerCase();return terms.some(t=>s.includes(t))}

function buildArchitecture(projectName:string,answers:Record<string,string>,version:number):Architecture{
  const corpus=Object.values(answers).join(" ");
  const users=splitIdeas(answers.users||"");
  const roles=users.length?users:["Administrator","Staff user","Customer / external user"];
  if(!roles.some(r=>/admin/i.test(r)))roles.unshift("Administrator");

  const screens=["Sign in / access","Dashboard","Project or record detail","Search / filter","Activity & audit history","Settings & permissions"];
  if(includesAny(corpus,["form","intake","application","request"]))screens.push("Intake / request form");
  if(includesAny(corpus,["document","file","photo","attachment"]))screens.push("Documents & files");
  if(includesAny(corpus,["map","plot","gis","location"]))screens.push("Map / location workspace");
  if(includesAny(corpus,["invoice","payment","quote","price"]))screens.push("Quotes / billing");
  if(includesAny(corpus,["schedule","calendar","appointment","deadline"]))screens.push("Calendar / schedule");
  if(includesAny(corpus,["report","analytics","metric"]))screens.push("Reports / analytics");

  const entities=["Organization","User","Role / membership","Project or primary record","Activity event","Artifact / document"];
  if(includesAny(corpus,["customer","client","buyer","seller","citizen","resident"]))entities.push("Customer / contact");
  if(includesAny(corpus,["property","home","parcel","grave","plot","location"]))entities.push("Property / location record");
  if(includesAny(corpus,["job","task","work order","production"]))entities.push("Task / work item");
  if(includesAny(corpus,["invoice","payment","quote"]))entities.push("Quote / invoice / payment");
  if(answers.automation)entities.push("Automation definition","Automation run","Approval request");

  const workflows=[
    "User signs in and is scoped to the correct organization/project",
    "Create or receive a new record/request",
    "Validate and route the record to the responsible role",
    "Track status changes and activity history",
    "Review exceptions or consequential actions before completion"
  ];
  splitIdeas(answers.currentProcess||answers.mustHave||"").forEach(v=>workflows.push(v));

  const automationItems=splitIdeas(answers.automation||"");
  const triggerIdeas=splitIdeas(answers.triggers||"");
  const approval=answers.approvals||"Human review for exceptions and consequential external actions";
  const automations=(automationItems.length?automationItems:["Status and deadline monitoring","Recurring project summary"]).map((name,i)=>({
    name,
    trigger:triggerIdeas[i]||triggerIdeas[0]||"New record, status change, or schedule",
    actions:`Evaluate conditions → perform ${name.toLowerCase()} → log result → notify responsible user`,
    approval
  }));

  const integrations=splitIdeas(answers.integrations||"");
  if(!integrations.length)integrations.push("Email / notifications","Supabase Auth + Postgres","Vercel deployment");

  const sensitivity=(answers.dataSensitivity||"Mixed / not sure").toLowerCase();
  const security=["Row-level security by organization and project","Least-privilege roles and memberships","Audit trail for status, automation, and approval changes","No service-role credentials in browser code"];
  if(sensitivity.includes("personal")||sensitivity.includes("financial")||sensitivity.includes("regulated"))security.push("Dedicated infrastructure review before production","Data minimization and retention policy","Explicit approval gates for sensitive actions");

  const requested=splitIdeas(answers.mustHave||"");
  const mvp=(requested.length?requested:["Authenticated dashboard","Primary record workflow","Search and status tracking","Automation audit trail"]).slice(0,6);
  const later=["Advanced analytics and reporting","Expanded integration library","Reusable templates and self-service configuration","Dedicated infrastructure when graduation criteria are met"];
  const buildSequence=["Confirm architecture and MVP scope","Finalize roles, permissions, and RLS","Create core data model","Build primary screens and record workflow","Add automation definitions and approval gates","Connect required integrations","Test happy paths, exceptions, and permissions","Deploy prototype and collect feedback","Graduate to production infrastructure when justified"];

  return {version,generatedAt:new Date().toISOString(),projectName,summary:answers.idea||answers.problem||`Architecture for ${projectName}`,roles:[...new Set(roles)].slice(0,8),screens:[...new Set(screens)],entities:[...new Set(entities)],workflows:[...new Set(workflows)].slice(0,10),automations,integrations:[...new Set(integrations)],security,mvp,later,buildSequence};
}

export default function ArchitecturePanel({projectSlug}:{projectSlug:string}){
  const[session,setSession]=useState<Session|null>(null);const[project,setProject]=useState<any>(null);const[answers,setAnswers]=useState<Record<string,string>>({});const[architecture,setArchitecture]=useState<Architecture|null>(null);const[message,setMessage]=useState("");const[busy,setBusy]=useState(false);const[loaded,setLoaded]=useState(false);

  useEffect(()=>{(async()=>{try{const raw=window.localStorage.getItem(SESSION_KEY);if(!raw){setMessage("Sign in from the Build page to load private discovery data and generate architecture.");return}const s=JSON.parse(raw) as Session;if(!s?.access_token){setMessage("Your Factory session is missing. Sign in again from the Build page.");return}setSession(s);const projects=await rest(`factory_projects?slug=eq.${encodeURIComponent(projectSlug)}&select=id,name,stage,progress,next_action&limit=1`,s);const p=Array.isArray(projects)?projects[0]:null;if(!p){setMessage("This project is not available in your signed-in Factory workspace.");return}setProject(p);const rows=await rest(`factory_intake_answers?project_id=eq.${p.id}&select=field_key,answer`,s);const map:Record<string,string>={};if(Array.isArray(rows))rows.forEach((r:any)=>{map[r.field_key]=text(r.answer)});setAnswers(map);const artifacts=await rest(`factory_artifacts?project_id=eq.${p.id}&artifact_type=eq.architecture&select=content,created_at&order=created_at.desc&limit=1`,s);const latest=Array.isArray(artifacts)?artifacts[0]:null;if(latest?.content)setArchitecture(latest.content as Architecture);}catch(e){setMessage(e instanceof Error?e.message:"Could not load Factory project.")}finally{setLoaded(true)}})()},[projectSlug]);

  const nextVersion=useMemo(()=>architecture?.version?architecture.version+1:1,[architecture]);
  function generate(){if(!project)return;setArchitecture(buildArchitecture(project.name,answers,nextVersion));setMessage("Architecture generated from the saved discovery. Review it before saving a new version.")}
  async function save(){if(!session||!project||!architecture)return;setBusy(true);setMessage("");try{await rest("factory_artifacts",session,{method:"POST",body:JSON.stringify({project_id:project.id,artifact_type:"architecture",title:`Architecture v${architecture.version}`,content:architecture})});await rest(`factory_projects?id=eq.${project.id}`,session,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({stage:"architecture",progress:Math.max(Number(project.progress)||0,35),next_action:"Review architecture, then materialize features and automations"})});setProject({...project,stage:"architecture",progress:Math.max(Number(project.progress)||0,35)});setMessage(`Architecture v${architecture.version} saved to the Factory.`)}catch(e){setMessage(e instanceof Error?e.message:"Could not save architecture.")}finally{setBusy(false)}}

  return <section className={styles.panel} id="architecture"><div className={styles.head}><div><span className={styles.tag}>Generate Architecture</span><h2>Turn discovery into a build system.</h2><p>The Factory converts the saved intake into structured roles, screens, data entities, workflows, automations, integrations, security controls, MVP scope and build sequence.</p>{project&&<div className={styles.meta}><span>{project.name}</span><span>Stage: {project.stage}</span><span>Next architecture version: {nextVersion}</span></div>}</div><div className={styles.actions}><button className={`${styles.button} ${styles.primary}`} disabled={!project||busy} onClick={generate}>{architecture?"Regenerate Architecture":"Generate Architecture"}</button>{architecture&&<button className={styles.button} disabled={busy} onClick={save}>{busy?"Saving…":`Save v${architecture.version}`}</button>}</div></div>{message&&<p className={styles.notice} role="status">{message}</p>}{!loaded&&!message?<div className={styles.empty}>Loading Factory discovery…</div>:architecture?<div className={styles.grid}><Card title="Product Summary" items={[architecture.summary]} /><Card title="User Roles" items={architecture.roles}/><Card title="Primary Screens" items={architecture.screens}/><Card title="Data Entities" items={architecture.entities}/><Card title="Core Workflows" items={architecture.workflows}/><Card title="Integrations" items={architecture.integrations}/><div className={`${styles.card} ${styles.wide}`}><h3>Automation Map</h3>{architecture.automations.map(a=><div className={styles.automation} key={a.name}><strong>{a.name}</strong><span><strong>Trigger</strong>{a.trigger}</span><span><strong>Actions</strong>{a.actions}</span><span><strong>Human control</strong>{a.approval}</span></div>)}</div><Card title="Security & Permissions" items={architecture.security}/><Card title="MVP" items={architecture.mvp}/><Card title="Later Phases" items={architecture.later}/><Card title="Build Sequence" items={architecture.buildSequence}/></div>:<div className={styles.empty}>No saved architecture yet. Generate one after the project has a saved discovery intake.</div>}</section>
}

function Card({title,items}:{title:string;items:string[]}){return <div className={styles.card}><h3>{title}</h3><ul>{items.map((item,i)=><li key={`${title}-${i}`}>{item}</li>)}</ul></div>}
