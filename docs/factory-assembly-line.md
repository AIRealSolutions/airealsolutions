# AI Real Solutions Factory Assembly Line

## Purpose
The Factory is not only a project tracker. It is intended to move a customer idea through a controlled software-production line using coordinated AI agents, human approval gates, GitHub, Vercel, Supabase, testing, and operating economics.

## Assembly line
1. **Onboarding Intake** — capture the problem, users, current process, desired outcome, integrations, add-ons, automations, data sensitivity, budget, economics and success criteria.
2. **AI Product Synthesis** — the Factory Manager agent reads all onboarding data and produces the canonical project content: executive summary, product brief, requirements, user roles, user stories, acceptance criteria, workflows, page/content map, automation opportunities, assumptions, open questions, and implementation instructions.
3. **Economic Gate** — establish who pays, customer/internal value, setup revenue, recurring revenue, build cost, operating cost, target price and break-even.
4. **Architecture** — Software Architect converts the approved brief into screens, entities, RLS/permissions, integrations, add-ons, automation map, deployment design, MVP and build sequence.
5. **AI Development** — Developer agent works from approved requirements and architecture. Work is broken into small testable changes.
6. **GitHub Delivery** — repository operations are first-class Factory work: choose/create repo, create branch when appropriate, write/update files, commit, open/review PR where required, and store repo/branch/commit/PR references in project artifacts/events.
7. **Vercel Deployment** — Deployment/QA agent checks that GitHub changes trigger the intended Vercel project, watches build status, captures failures, verifies production alias/domain and records deployment ID/URL.
8. **QA & Security** — test required routes and acceptance criteria; verify auth/tenant boundaries/RLS; run Supabase advisors after DDL; inspect deployment/build failures; do not advance a failed gate.
9. **Launch** — human approval before consequential production promotion. Record production URL, version/commit and handoff.
10. **Operate & Improve** — monitor automations, failures, usage, costs, customer value, credits and improvement queue.

## Agent team
**Factory Manager / Product Synthesis Agent** owns the project context. Its system context must include the complete onboarding answers, latest build brief, economics, latest approved architecture, existing artifacts, project events, repository/deployment references, and outstanding approvals. It turns raw customer language into structured content consumed by downstream agents.

Specialists:
- Software Architect
- Developer
- Automation Engineer
- CRM / Operations
- Marketing / SEO / Content
- Accounting / Business Operations
- QA & Security
- Deployment Agent

The Factory Manager delegates but remains responsible for assembling one current canonical project context.

## Required agent outputs
Product synthesis should be stored as a versioned artifact, never only displayed in chat. Minimum structured output:
- product_summary
- problem_statement
- desired_outcomes
- users_and_roles
- requirements
- user_stories
- acceptance_criteria
- screens_and_content
- workflows
- automation_opportunities
- integrations
- data_and_security
- economics_questions
- assumptions
- open_questions
- recommended_agents
- recommended_addons
- build_sequence

## GitHub and Vercel execution
These are **partially implemented today, not complete autonomous Factory features**. AI Real Solutions can currently operate GitHub and Vercel through connected tools during development, but the Factory web application does not yet have a secure server-side worker that independently holds scoped GitHub/Vercel credentials and executes those actions for every customer project.

Before autonomous execution:
- credentials/tokens must remain server-side and scoped per organization/project;
- customer/browser must never receive GitHub, Vercel, Supabase service-role, or model-provider secrets;
- repository writes need an approval policy (branch/PR by default; direct main only for explicitly approved internal projects);
- deployments must be correlated to commit SHA and project;
- failures must stop the assembly line and create a repair task;
- every external action must create an audit event and consume/reserve Factory Credits where applicable;
- retries must be idempotent.

## Current implementation status
### Working
- Guided onboarding and local draft persistence.
- Generated deterministic build brief.
- Saving intake/build brief into Factory.
- Project registry/workspaces.
- Economics panel.
- Deterministic architecture generation and materialization.
- Features and automations as project records.
- Agent specialty catalog and credit estimates.
- Add-on catalog.
- Account/admin/credit infrastructure.
- Vercel-hosted Factory with GitHub-driven deployment.
- Assembly-stage catalog and per-project stage records.

### Partial
- Factory Manager: role/catalog exists; full LLM synthesis/execution loop is not yet wired.
- AI Development: development can be performed with connected AI/GitHub tools, but is not yet an autonomous in-app worker.
- GitHub Delivery: current development process pushes commits, but project-scoped repository execution/audit UI remains to build.
- Vercel Deployment: current process can inspect deployments, but automated per-project deployment gate/repair loop remains to build.
- QA: manual/tool-assisted checks exist; acceptance-test runner and gate persistence remain to build.
- Credit metering: ledger/admin/wallet exist; reserve/settle around agent/tool runs remains to build.

### Not yet complete
- Secure server-side agent execution runtime.
- Model/provider routing for the Product Synthesis Agent.
- Project-scoped GitHub/Vercel connection management.
- Autonomous branch/PR/code/test/deploy loop.
- Automated signup/workspace provisioning.
- Paid checkout/subscription activation.

## Safety and quality rule
No assembly stage should be marked passed merely because an agent produced output. Each stage has a gate. Failed builds, failed tests, unresolved security issues, missing economics, or required human approvals hold the project at that stage.

## Next implementation order
1. Product Synthesis artifact + Factory Manager context builder.
2. Assembly Line UI in each project workspace.
3. Approval/gate records for synthesis and architecture.
4. Project repository/deployment connection records.
5. Secure server-side GitHub delivery action.
6. Vercel deployment watcher and failure-to-repair task.
7. QA acceptance runner.
8. Transactional credit reserve/settle around every agent/tool run.
9. Controlled autonomous iteration after the above is observable and auditable.
