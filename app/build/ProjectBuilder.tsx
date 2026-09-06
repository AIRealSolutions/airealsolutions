"use client";

import { useMemo, useState } from "react";

type FormState = {
  organization: string;
  industry: string;
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

const initialState: FormState = {
  organization: "",
  industry: "",
  problem: "",
  users: "",
  currentProcess: "",
  desiredOutcome: "",
  mustHave: "",
  integrations: "",
  dataSensitivity: "",
  timeline: "",
  budget: "",
  success: "",
};

export default function ProjectBuilder() {
  const [form, setForm] = useState<FormState>(initialState);
  const [showBrief, setShowBrief] = useState(false);

  const brief = useMemo(() => {
    return `AI REAL SOLUTIONS — PROJECT BUILD BRIEF\n\nOrganization: ${form.organization || "Not provided"}\nIndustry / use case: ${form.industry || "Not provided"}\n\nCore problem\n${form.problem || "Not provided"}\n\nPrimary users\n${form.users || "Not provided"}\n\nCurrent process\n${form.currentProcess || "Not provided"}\n\nDesired outcome\n${form.desiredOutcome || "Not provided"}\n\nMust-have capabilities\n${form.mustHave || "Not provided"}\n\nSystems / integrations\n${form.integrations || "Not provided"}\n\nData sensitivity / compliance\n${form.dataSensitivity || "Not provided"}\n\nTimeline\n${form.timeline || "Not provided"}\n\nBudget range\n${form.budget || "Not provided"}\n\nSuccess looks like\n${form.success || "Not provided"}\n\nBUILD INSTRUCTION\nDesign the smallest useful version first. Recommend the application architecture, data model, user roles, integrations, AI-assisted features, security controls, launch phases, and an MVP scope. Separate features that are essential now from features that should wait until later phases.`;
  }, [form]);

  const update = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const copyBrief = async () => {
    await navigator.clipboard.writeText(brief);
  };

  return (
    <div className="builder-shell">
      <div className="builder-intro">
        <span className="product-tag">Software Factory Intake</span>
        <h2>Turn an idea into a build-ready brief.</h2>
        <p>
          This intake is designed around the questions a software team and AI coding system need answered before useful development begins.
        </p>
      </div>

      <div className="builder-grid">
        <form className="builder-form" onSubmit={(event) => { event.preventDefault(); setShowBrief(true); }}>
          <label>
            Organization or project name
            <input value={form.organization} onChange={(e) => update("organization", e.target.value)} placeholder="Example: Town Clerk Office or Coastal Sign Co." />
          </label>

          <label>
            Industry or use case
            <input value={form.industry} onChange={(e) => update("industry", e.target.value)} placeholder="Government, real estate, service business, nonprofit..." />
          </label>

          <label>
            What problem are you trying to solve?
            <textarea value={form.problem} onChange={(e) => update("problem", e.target.value)} placeholder="Describe the frustration, bottleneck, missed opportunity, or manual task." />
          </label>

          <label>
            Who will use the system?
            <textarea value={form.users} onChange={(e) => update("users", e.target.value)} placeholder="Staff, customers, managers, citizens, field crews, vendors..." />
          </label>

          <label>
            How is the work handled today?
            <textarea value={form.currentProcess} onChange={(e) => update("currentProcess", e.target.value)} placeholder="Email, spreadsheets, paper forms, another software product, phone calls..." />
          </label>

          <label>
            What should the finished system make easier?
            <textarea value={form.desiredOutcome} onChange={(e) => update("desiredOutcome", e.target.value)} placeholder="Faster turnaround, fewer errors, better customer service, visibility, automation..." />
          </label>

          <label>
            Must-have features
            <textarea value={form.mustHave} onChange={(e) => update("mustHave", e.target.value)} placeholder="Accounts, dashboard, search, document upload, payments, AI assistant, reports..." />
          </label>

          <label>
            Existing systems that should connect
            <textarea value={form.integrations} onChange={(e) => update("integrations", e.target.value)} placeholder="Google Workspace, QuickBooks, Stripe, GIS, CRM, website, database..." />
          </label>

          <div className="builder-two">
            <label>
              Data sensitivity
              <select value={form.dataSensitivity} onChange={(e) => update("dataSensitivity", e.target.value)}>
                <option value="">Select</option>
                <option>Public / low sensitivity</option>
                <option>Internal business data</option>
                <option>Personal customer data</option>
                <option>Financial or regulated data</option>
                <option>Not sure</option>
              </select>
            </label>

            <label>
              Desired timeline
              <select value={form.timeline} onChange={(e) => update("timeline", e.target.value)}>
                <option value="">Select</option>
                <option>Prototype quickly</option>
                <option>30–60 days</option>
                <option>60–120 days</option>
                <option>Longer phased project</option>
                <option>Not sure</option>
              </select>
            </label>
          </div>

          <div className="builder-two">
            <label>
              Budget range
              <select value={form.budget} onChange={(e) => update("budget", e.target.value)}>
                <option value="">Select</option>
                <option>Exploring / prototype</option>
                <option>Under $5,000</option>
                <option>$5,000–$15,000</option>
                <option>$15,000–$50,000</option>
                <option>$50,000+</option>
                <option>Need help defining it</option>
              </select>
            </label>

            <label>
              How will you know it worked?
              <input value={form.success} onChange={(e) => update("success", e.target.value)} placeholder="Example: save 20 staff hours per week" />
            </label>
          </div>

          <button className="button button-primary builder-submit" type="submit">Create My Build Brief</button>
        </form>

        <aside className="builder-side">
          <span className="card-number">01</span>
          <h3>Discovery becomes the first product.</h3>
          <p>Instead of beginning with a vague request, the customer leaves onboarding with a structured definition of the problem, users, workflow, data, scope, and success criteria.</p>
          <div className="factory-flow">
            <span>Intake</span><span>→</span><span>Brief</span><span>→</span><span>Prototype</span><span>→</span><span>Production</span>
          </div>
        </aside>
      </div>

      {showBrief && (
        <section className="brief-output" aria-live="polite">
          <div className="brief-heading">
            <div>
              <span className="product-tag">Generated Build Brief</span>
              <h3>Ready for discovery, estimation, or AI-assisted development.</h3>
            </div>
            <button className="button button-secondary" type="button" onClick={copyBrief}>Copy Brief</button>
          </div>
          <pre>{brief}</pre>
        </section>
      )}
    </div>
  );
}
