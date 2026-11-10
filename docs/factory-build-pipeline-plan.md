# Factory Build Pipeline Plan: Onboarding → AI Build → Preview → Own Infrastructure

## Goal
A customer (business, government office or individual) finishes onboarding at `/build`. The Factory then:

1. turns the answers into a spec an LLM can work from,
2. has an AI agent write the code for a basic site and check that it builds and works,
3. gives the customer (and their possible investors) a preview link with real working parts,
4. once approved, moves the product onto its own GitHub repo, Supabase database, Vercel hosting and domain (GoDaddy DNS).

This plan picks up where `docs/factory-assembly-line.md` stops. That document sets out the stages and gates. This one covers how stages 5–9 actually run.

## Where we are today (checked 2026-11-06)
| Piece | Status |
|---|---|
| Guided onboarding (`app/build/ProjectBuilder.tsx`) | Working; drafts kept in browser storage |
| Save to Factory (`FactorySavePanel.tsx`) | Working, but `factory_intake_answers` has **0 rows** in Supabase, so no real intake has gone through yet |
| Product synthesis (`ProductSynthesisPanel.tsx`) | **Spec Agent built (2026-11-10)**: "Generate with AI" calls `POST /api/factory/synthesis`. Template `make()` kept as "Template draft" and as the fallback when the server has no keys |
| Architecture, economics, assembly-line records | Working, template-based |
| `factory_agent_runs`, `factory_credit_ledger`, `factory_assembly_stages` | Tables exist; the Spec Agent records its runs and credits here |
| Code generation, build/check loop, preview, graduation | **Not built** |

All Factory database calls today come from the browser using the publishable key plus the user's session. That works for CRUD. Anything that holds a secret (LLM key, GitHub token, Vercel token, Supabase management token) has to run **server-side only**: Next.js route handlers or a background worker on Vercel, never in the browser.

## The pipeline

```
Onboarding answers
   │
   ▼
[1] Spec Agent (LLM) ──► Product Synthesis v1 (JSON, versioned) ──► human approves
   │
   ▼
[2] Site Spec (LLM) ──► pages, sections, forms, data entities, automations (JSON)
   │
   ├──► [3a] Instant Preview: generic renderer draws the Site Spec at /preview/{slug}
   │
   ▼
[3b] Code Agent (LLM) writes a Next.js + Supabase app from a starter template
   │
   ▼
[4] Check loop in a Vercel Sandbox: install → typecheck → build → smoke tests
   │      ▲  failures go back to the Code Agent (at most N tries)
   │      └──────────────┘
   ▼
[5] Preview deployment (Vercel preview URL) + demo data + investor share link
   │      customer approves
   ▼
[6] Graduation: own GitHub repo, own Supabase project, own Vercel project, domain
```

### 1. Spec Agent: onboarding → product synthesis
- New server route `app/api/factory/synthesis/route.ts`. It checks the user's Supabase session, loads the intake answers, economics and add-ons, and calls the Claude API with a system prompt and a **JSON schema output** that matches the existing `Synthesis` type in `ProductSynthesisPanel.tsx`. The UI keeps working unchanged.
- Model: a mid-tier Claude model for synthesis (fast and cheap), with the strongest model as a fallback for long or complex intakes.
- Prompt inputs: every intake field, industry, data sensitivity, budget and timeline, plus a short "house rules" block: build the MVP only, keep secrets server-side, use row-level security, require human approval for consequential actions.
- Output goes into `factory_product_syntheses` (versioned) and is logged in `factory_agent_runs` (model, tokens, cost, duration). Credits are reserved before the call and settled after it.
- The existing template `make()` stays as the fallback when the LLM call fails.
- Gate: a human approves the synthesis, as the current button already does.

**Built (2026-11-10).** How it works now:
- Files: `app/api/factory/synthesis/route.ts` (route), `app/lib/agents/spec-agent.ts` (prompt, JSON schema, Claude call, cost), `docs/factory-agent-runs.sql` (credit functions, applied as migration `factory_agent_run_credits`).
- Model: picked by `factory_resolve_model(project, 'synthesis', 'factory_manager', 'product_synthesis')`, so an assignment in `factory_model_assignments` overrides it. Today the catalog default is Claude Sonnet 5.5. A non-Anthropic pick, or a routing error, falls back to Claude Opus 5.5. Adaptive thinking, effort `high` unless the assignment sets one, structured JSON output, and server-side refusal fallback (`fallbacks: "default"`).
- Context sent: project record, every intake answer, latest build brief, economics, selected add-ons, the add-on catalog, and the previous synthesis (for regenerations). Customer text is marked as data, not instructions.
- Credits: `factory_agent_specialties.default_credit_estimate` for `factory_manager` (150) × the model's `credit_multiplier`. `factory_agent_run_reserve` (run as the user) checks access and balance and opens the run. `factory_agent_run_settle` (service role only) charges on success and refunds in full on failure. Settling twice is a no-op.
- Output: a **draft** row in `factory_product_syntheses` (`source: "spec_agent"`, model, `agent_run_id`), an audit event `synthesis.generated`, and token counts and estimated USD cost on the `factory_agent_runs` row. Approving a draft marks it `approved` and older approved versions `superseded`.
- Server env vars (Vercel): `ANTHROPIC_API_KEY` and `SUPABASE_SECRET_KEY` (the project's secret key; `SUPABASE_SERVICE_ROLE_KEY` also works). Without both, `GET /api/factory/synthesis` reports `configured: false` and the panel shows only the template.
- Known gap: if the server dies mid-call, the run stays `running` and its credits stay reserved. A sweep that refunds runs stuck for more than 10 minutes belongs with the build worker (step 3b).

### 2. Site Spec: what the basic site contains
Before writing code, a second LLM call turns the approved synthesis into a small, strict **Site Spec** (JSON):
- `brand`: name, tagline, colors, tone
- `pages[]`: route, title, ordered `sections[]` (hero, features, pricing, FAQ, contact form, dashboard table, map, etc. from a fixed list of section types)
- `entities[]`: data tables with fields (for example `leads`, `properties`, `appointments`)
- `forms[]`: which entity each form writes to
- `automations[]`: trigger → action (for example "new lead → email owner"), mapped onto `factory_automations`
- `demo_data`: seed rows so the preview looks alive

Because the section types come from a fixed list, the LLM cannot invent things the renderer and code templates do not support. That keeps the output predictable and cheap to check.

### 3a. Instant preview (no code generated)
- New route `app/preview/[slug]/page.tsx` renders any Site Spec with a library of prebuilt section components.
- Forms write into a sandboxed shared table (`factory_preview_submissions`, scoped by project) so they **really work**: a visitor can submit a lead and see it show up on the demo dashboard.
- Takes seconds and costs little, so the customer sees something on the same day as onboarding. This is the version to show early investors.

### 3b. Code Agent: real code
- Starts from a **starter template repo** (Next.js + Supabase auth + RLS + Tailwind + Resend email) rather than an empty folder. The agent fills in pages, components, SQL migrations and automations from the Site Spec.
- Runs as a background job (not inside a page request): a route handler adds a row to a new `factory_build_jobs` table, and a worker (Vercel Function with long duration, or Vercel Sandbox) picks it up.
- Uses the Claude API with tools: `read_file`, `write_file`, `run_command` (inside the sandbox only), `list_files`. Every file write is recorded.
- Hard limits per job: maximum tries, maximum tokens or credits, maximum wall-clock time. If any limit is hit, the job stops and opens a repair task. It does not keep spending.

### 4. Check loop (the "check" part)
Inside a Vercel Sandbox (an isolated microVM that is thrown away after the job):
1. `npm ci`
2. `tsc --noEmit`
3. `next build`
4. Apply SQL migrations to a throwaway Postgres or Supabase branch
5. Playwright smoke tests **generated from the acceptance criteria**: each page loads, each form submits, login works, a user cannot read another tenant's rows
6. Supabase security advisors on the migration

If a step fails, the error output goes back to the Code Agent ("fix this"), up to N tries (start with 3). Each try is a row in `factory_build_iterations` with logs, so the customer and admin can see what happened. A stage is passed **only when the checks pass**, never just because the agent says it is done (same rule as the assembly-line doc).

### 5. Preview and investor mode
- When checks pass, the code is pushed to a branch, and Vercel creates a **preview deployment**. Its URL is saved in `factory_previews`.
- Working elements to include by default so the demo is convincing:
  - landing page with the customer's brand and copy,
  - a lead or contact form that saves to the database and emails the owner,
  - a simple signed-in dashboard listing those records,
  - one live automation from their intake (for example a status-change email),
  - seeded demo data, clearly marked as demo.
- **Investor share link**: `/preview/{slug}?invite=…`. Read-only or demo login, an optional PIN (same pattern as Golf Buddy), a banner reading "Prototype built by AI Real Solutions", and a one-page summary pulled from the synthesis and economics (problem, market, pricing, break-even).
- View tracking (who opened the link, when, which pages) is stored in `factory_preview_views`, so the customer can see investor interest.

### 6. Graduation: the product's own infrastructure
Triggered by a human "Launch" approval and a paid plan. Each step is recorded in `factory_graduations`:
1. **GitHub**: create a repo in the customer's org (or in ours, then transfer it), push the approved commit.
2. **Supabase**: create a new project for the customer, run the migrations, copy any real data out of the shared preview tables, set up auth email (Resend, per `docs/resend-supabase-auth.md`).
3. **Vercel**: create a project linked to the repo, set environment variables (Supabase URL and keys, Resend key) server-side, deploy to production.
4. **Domain**: add the domain in Vercel and give the customer, or ourselves for our own domains on GoDaddy, the exact DNS records (an `A` record for the root domain, a `CNAME` for `www`). Verify, then confirm HTTPS.
5. **Handoff**: production URL, commit SHA, admin login, a runbook, and the monthly operating-cost estimate from the economics panel.

Billing ownership (who pays for Supabase, Vercel and the domain) has to be decided at the economics gate. Two options: the customer owns the accounts, or AI Real Solutions hosts it as a managed service and charges a monthly fee.

## New database tables (sketch)
| Table | Purpose |
|---|---|
| `factory_site_specs` | Versioned Site Spec JSON per project |
| `factory_build_jobs` | Queue: project, spec version, status, limits, reserved credits |
| `factory_build_iterations` | Each try: files changed, command logs, check results |
| `factory_previews` | Preview URL, commit SHA, kind (instant or deployed), invite token, PIN |
| `factory_preview_submissions` | Form submissions from instant previews (project-scoped, RLS) |
| `factory_preview_views` | Investor link views |
| `factory_project_connections` | Repo, Vercel project ID, Supabase project ref per project (no secrets stored here) |
| `factory_graduations` | Launch checklist status and audit |

All with RLS through `factory_can_access_project`. Worker writes use the service role on the server only.

## Secrets and safety
- LLM, GitHub, Vercel and Supabase-management tokens are Vercel environment variables, used only in route handlers and workers.
- Generated code runs **only** in Vercel Sandbox, never on the Factory's own server.
- Code goes to a branch or PR by default. Production promotion needs a human click.
- Every external action writes `factory_project_events` and reserves then settles credits.
- Per-job spend caps keep a looping agent from running up LLM cost.

## Build order (each step can ship on its own)
1. **LLM Spec Agent**: server route plus Claude call behind the existing "Generate Product Synthesis" button, with the template as fallback. *Small; immediately makes onboarding smarter.*
2. **Site Spec plus instant preview renderer** at `/preview/[slug]`, with working forms and demo data. *First thing a customer or investor can click.*
3. **Investor share link**: PIN or invite, banner, summary page, view tracking.
4. **Starter template repo** (Next.js + Supabase + Resend) with RLS and smoke tests already passing.
5. **Build jobs plus Vercel Sandbox check loop** (typecheck, build, tests, advisors), with try limits and logs.
6. **Push to branch, Vercel preview deployment**, URL saved back to the project.
7. **Graduation**: new repo, Supabase project, Vercel project, env vars, domain and DNS instructions, handoff.
8. **Credits reserve/settle around every agent run** (can be built alongside steps 1–7).

## Good first test projects
Our own products make good first runs, because we know what "right" looks like:
- a HUD-home buyer lead site for Lightkeeper Realty / USAHUDHomes.com referrals,
- a local listings and contact site in the style of findanchome.com,
- an NC bill-tracker alert signup for ncissues.com,
- a CemeteryBuilder plot-layout request form.

## Open decisions
- Which Claude models to use for synthesis versus code generation, and the credit price per run.
- Whether the customer owns the GitHub, Vercel and Supabase accounts, or we host as a managed service.
- How many automatic fix attempts before a human steps in (proposed: 3).
- Whether the instant preview is free (lead generation) and the code build is paid.
