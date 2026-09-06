"use client";

import { useMemo, useState } from "react";

type FormState = {
  organization: string;
  industry: string;
  idea: string;
  problem: string;
  users: string;
  currentProcess: string;
  desiredOutcome: string;
  mustHave: string;
  integrations: string;
  dataSensitivity: string;
  timeline: string;
  budget: string;
  success: string;
};

type Step = {
  id: string;
  label: string;
  title: string;
  description: string;
  fields: (keyof FormState)[];
};

const steps: Step[] = [
  { id: "idea", label: "Idea", title: "Start with the opportunity", description: "Tell us what you want to improve or create. A rough idea is enough.", fields: ["organization", "industry", "idea"] },
  { id: "discovery", label: "Discovery", title: "Define the real problem", description: "Good software removes friction. Describe what is failing, slow, repetitive, or missing today.", fields: ["problem", "currentProcess", "desiredOutcome"] },
  { id: "users", label: "Users", title: "Who needs this system?", description: "Identify the people who use it, manage it, approve work, or receive information from it.", fields: ["users"] },
  { id: "workflow", label: "Workflow", title: "Describe the working system", description: "List the capabilities and outside systems the first useful version should support.", fields: ["mustHave", "integrations"] },
  { id: "data", label: "Data", title: "Plan for the information", description: "Data sensitivity helps determine authentication, isolation, storage, and whether a product can live in shared factory infrastructure.", fields: ["dataSensitivity"] },
  { id: "scope", label: "Scope", title: "Set the launch target", description: "Give us enough context to recommend an MVP rather than trying to build everything at once.", fields: ["timeline", "budget", "success"] },
];

const initialState: FormState = {
  organization: "", industry: "", idea: "", problem: "", users: "", currentProcess: "", desiredOutcome: "", mustHave: "", integrations: "", dataSensitivity: "", timeline: "", budget: "", success: "",
};

export default function ProjectBuilder() {
  const [form, setForm] = useState<FormState>(initialState);
  const [stepIndex, setStepIndex] = useState(0);
  const [showBrief, setShowBrief] = useState(false);
  const [copied, setCopied] = useState(false);
  const step = steps[stepIndex];
  const progress = Math.round(((stepIndex + 1) / steps.length) * 100);

  const brief = useMemo(() => `AI REAL SOLUTIONS — SOFTWARE FACTORY BUILD BRIEF\n\nPROJECT\nOrganization / project: ${form.organization || "Not provided"}\nIndustry / use case: ${form.industry || "Not provided"}\nIdea: ${form.idea || "Not provided"}\n\nPROBLEM & OUTCOME\nCore problem: ${form.problem || "Not provided"}\nCurrent process: ${form.currentProcess || "Not provided"}\nDesired outcome: ${form.desiredOutcome || "Not provided"}\n\nUSERS\n${form.users || "Not provided"}\n\nMVP CAPABILITIES\n${form.mustHave || "Not provided"}\n\nINTEGRATIONS\n${form.integrations || "Not provided"}\n\nDATA & SECURITY\n${form.dataSensitivity || "Not provided"}\n\nDELIVERY\nTimeline: ${form.timeline || "Not provided"}\nBudget range: ${form.budget || "Not provided"}\nSuccess criteria: ${form.success || "Not provided"}\n\nFACTORY INSTRUCTION\nAct as a product architect. Design the smallest useful version first. Produce: 1) product summary, 2) user roles, 3) primary screens, 4) core workflows, 5) recommended data entities, 6) integrations, 7) AI-assisted features, 8) security and permissions, 9) MVP versus later phases, 10) deployment architecture, and 11) a build sequence suitable for AI-assisted software development. Prefer shared factory infrastructure for low-risk prototypes and recommend dedicated infrastructure when security, scale, compliance, or product maturity justifies it.`, [form]);

  const update = (field: keyof FormState, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const next = () => { setShowBrief(false); setStepIndex((i) => Math.min(i + 1, steps.length - 1)); };
  const back = () => { setShowBrief(false); setStepIndex((i) => Math.max(i - 1, 0)); };
  const finish = () => setShowBrief(true);
  const copyBrief = async () => { await navigator.clipboard.writeText(brief); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };

  const field = (name: keyof FormState, label: string, placeholder: string, kind: "input" | "textarea" = "textarea") => (
    <label key={name}>{label}
      {kind === "textarea" ? <textarea value={form[name]} onChange={(e) => update(name, e.target.value)} placeholder={placeholder} /> : <input value={form[name]} onChange={(e) => update(name, e.target.value)} placeholder={placeholder} />}
    </label>
  );

  return (
    <div className="builder-shell">
      <div className="builder-intro">
        <span className="product-tag">Software Factory Intake</span>
        <h2>Build the specification before we build the software.</h2>
        <p>Move through six short stages. Your answers become a reusable product brief that can guide architecture, estimation, prototyping, and AI-assisted development.</p>
      </div>

      <div className="factory-stepper" aria-label="Project discovery progress">
        {steps.map((item, index) => (
          <button key={item.id} type="button" className={`factory-step ${index === stepIndex ? "active" : ""} ${index < stepIndex ? "complete" : ""}`} onClick={() => { setStepIndex(index); setShowBrief(false); }}>
            <span>{index < stepIndex ? "✓" : index + 1}</span><strong>{item.label}</strong>
          </button>
        ))}
      </div>
      <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>

      <div className="builder-grid">
        <section className="builder-form factory-stage">
          <div className="stage-heading"><span className="card-number">0{stepIndex + 1} / 0{steps.length}</span><h3>{step.title}</h3><p>{step.description}</p></div>

          {step.id === "idea" && <>{field("organization", "Organization or project name", "Example: Coastal Sign Co.", "input")}{field("industry", "Industry or use case", "Government, real estate, service business, nonprofit...", "input")}{field("idea", "What would you like to build or improve?", "Describe the idea in ordinary language. You do not need technical terminology.")}</>}
          {step.id === "discovery" && <>{field("problem", "What problem are you trying to solve?", "What is frustrating, expensive, slow, repetitive, or getting lost?")}{field("currentProcess", "How is the work handled today?", "Email, spreadsheets, paper, phone calls, another system...")}{field("desiredOutcome", "What should become easier?", "Faster turnaround, fewer errors, better visibility, self-service, automation...")}</>}
          {step.id === "users" && <>{field("users", "Who will use or interact with it?", "Customers, staff, managers, citizens, vendors, administrators. Note what each group needs to do.")}</>}
          {step.id === "workflow" && <>{field("mustHave", "What must the first useful version do?", "Accounts, dashboard, search, forms, documents, approvals, payments, reports, AI assistant...")}{field("integrations", "What should it connect to?", "Google Workspace, QuickBooks, Stripe, GIS, CRM, website, existing database...")}</>}
          {step.id === "data" && <label>What kind of information will the software handle?<select value={form.dataSensitivity} onChange={(e) => update("dataSensitivity", e.target.value)}><option value="">Select the closest fit</option><option>Public / low sensitivity</option><option>Internal business data</option><option>Personal customer data</option><option>Financial or regulated data</option><option>Mixed / not sure</option></select></label>}
          {step.id === "scope" && <><div className="builder-two"><label>Desired timeline<select value={form.timeline} onChange={(e) => update("timeline", e.target.value)}><option value="">Select</option><option>Prototype quickly</option><option>30–60 days</option><option>60–120 days</option><option>Longer phased project</option><option>Not sure</option></select></label><label>Budget range<select value={form.budget} onChange={(e) => update("budget", e.target.value)}><option value="">Select</option><option>Exploring / prototype</option><option>Under $5,000</option><option>$5,000–$15,000</option><option>$15,000–$50,000</option><option>$50,000+</option><option>Need help defining it</option></select></label></div>{field("success", "How will you know it worked?", "Example: save 20 staff hours each week, reduce response time, generate 25 leads per month...", "input")}</>}

          <div className="stage-actions">{stepIndex > 0 && <button className="button button-secondary" type="button" onClick={back}>Back</button>}<button className="button button-primary" type="button" onClick={stepIndex === steps.length - 1 ? finish : next}>{stepIndex === steps.length - 1 ? "Create Build Brief" : "Continue"}</button></div>
        </section>

        <aside className="builder-side factory-dashboard">
          <span className="product-tag">Factory workspace</span><h3>{form.organization || "Your software project"}</h3><p>{form.idea || "As you answer the questions, this workspace becomes the specification for your first build."}</p>
          <div className="factory-metrics"><div><strong>{progress}%</strong><span>Discovery</span></div><div><strong>{stepIndex + 1}/6</strong><span>Stage</span></div><div><strong>MVP</strong><span>First target</span></div></div>
          <div className="factory-flow vertical"><span>Discovery brief</span><span>↓</span><span>Architecture</span><span>↓</span><span>Prototype</span><span>↓</span><span>Test & launch</span></div>
          <p className="factory-note">Prototype data can later be stored in shared, project-isolated factory infrastructure. Mature or sensitive products can graduate to dedicated infrastructure.</p>
        </aside>
      </div>

      {showBrief && <section className="brief-output" aria-live="polite"><div className="brief-heading"><div><span className="product-tag">Generated Build Brief</span><h3>Discovery is now a reusable development artifact.</h3></div><button className="button button-secondary" type="button" onClick={copyBrief}>{copied ? "Copied" : "Copy Brief"}</button></div><pre>{brief}</pre><div className="brief-next"><strong>Next factory stage</strong><p>This brief can feed a product architect to generate screens, roles, data entities, architecture, MVP scope, and the initial development plan.</p></div></section>}
    </div>
  );
}
