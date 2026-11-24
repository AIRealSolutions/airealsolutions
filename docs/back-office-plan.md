# AI Real Solutions Back Office ("The Office") — Plan

**Date:** 2026-11-24 · **Status:** Proposed, nothing built yet

## 1. The idea in one paragraph

AI Real Solutions (ARS) becomes the **hub** for every business you run. The site gets two separate halves:

| | **The Factory** (keep as is) | **The Office** (new) |
|---|---|---|
| Who uses it | Clients | You (and later staff or contractors) |
| What it does | Takes a client from idea to a live product: onboarding, spec, build, preview, own infrastructure | Runs your companies: daily goals, schedule, CRM, social media, marketing material, notes and ideas |
| Where | `/factory`, `/build` | `/office` (admin-only) |
| Data | `factory_*` tables, one org per client | `office_*` tables, only you can read them |

The Factory stays the product you share with clients. The Office is the private desk where you organize your thoughts and get a list of what to finish today for each company.

## 2. The businesses the Office manages

Each one is a **Business** record. Everything else (tasks, contacts, posts, events, notes) is tagged with one.

| Business | Type | What the Office does for it |
|---|---|---|
| **AI Real Solutions** | Parent, software / AI | Factory pipeline, client sales, brand content |
| **Lightkeeper Realty** | Brokerage | Listings, buyer/seller pipeline, compliance dates, closings |
| **USAHUDHomes.com** | HUD referral business | Referral leads, bid deadlines, follow-ups with agents and buyers |
| **FindANCHome.com** | Local SE NC real estate | Local leads, listing promotion, neighborhood reels |
| **CemeteryBuilder.ai** | AI product | Development tasks, AI-agent layout work, demos for cemeteries |
| **NCIssues.com** | Civic watchdog | Bill tracking turned into posts, a voter newsletter |
| **VirtualClerk.ai, ElectionAgents.com, SignForge** | Products | Roadmap tasks, launch content |
| **Golf Buddy** | Side app | Low-priority maintenance tasks |

Each business can be marked **Focus / Active / Parked**, which controls how much of the daily plan it gets.

## 3. Office modules

### 3.1 Today (home screen, `/office`)
- **3–5 daily goals** made by an AI planner from your open tasks, calendar, overdue CRM follow-ups, scheduled posts and each business's weekly focus.
- Each goal shows its business, why it was picked ("HUD bid deadline Thursday"), and a time estimate.
- Today's calendar (already connected through Google Calendar).
- A **quick capture box**: type or dictate an idea, and AI files it under the right business as a note or task.
- An end-of-day check-in: mark goals done, push what's left to tomorrow, and the planner learns your real pace.

### 3.2 Schedule (`/office/schedule`)
- A week view that combines Google Calendar events with **time blocks** for each business (for example, Mon/Wed mornings for real estate, Tue/Thu for CemeteryBuilder).
- A weekly review on Sunday evening: AI drafts next week's focus for each business and you approve it.
- Recurring duties: license renewals, HUD bid periods, NC General Assembly session days, content days.

### 3.3 CRM (`/office/crm`)
- **Contacts** (people) and **Companies**, each tagged with one or more businesses, so one person can be a HUD buyer and a CemeteryBuilder prospect.
- **Pipelines per business**, each with its own stages:
  - Real estate: Lead → Contacted → Showing → Offer → Under contract → Closed
  - HUD referral: Referral in → Bid prep → Bid submitted → Accepted → Closed / Paid
  - Software (ARS, CemeteryBuilder): Lead → Discovery → Proposal → Factory project → Live
- An activity timeline: emails (from the Gmail connection), calls, notes, meetings.
- **Follow-up agent:** spots deals going quiet and drafts the follow-up email for you to approve. It never sends on its own.
- Lead intake: contact forms on findanchome.com, airealsolutions.com and usahudhomes.com all post into the Office.
- A link to the Factory: when a software deal is won, one click turns it into a Factory project.

### 3.4 Content Studio: social media and video (`/office/studio`)
- **Content calendar** across businesses and channels (Facebook, Instagram, YouTube, TikTok, LinkedIn, X).
- **Idea → Script → Assets → Scheduled → Published → Results** pipeline for each piece.
- AI helpers:
  - **Reel / Short writer:** a hook, a 30–60 s script, shot list, captions and hashtags (e.g. "3 things to know before bidding on a HUD home").
  - **YouTube planner:** title options, outline, description, chapters and a thumbnail brief.
  - **Repurposer:** one long video or blog post becomes a reel, a carousel and posts.
  - **NCIssues bill-to-post:** a bill status change becomes a plain-language post and a newsletter item.
  - **Listing promo:** a new listing becomes a reel script, posts and an email blast.
- **Brand kits for each business:** logo, colors, voice, disclaimers. Real estate posts get Equal Housing and broker disclosures added automatically.
- Video production in stages (decision in §7):
  1. Scripts, shot lists and captions only (you film on your phone).
  2. Auto-assembled reels from photos/clips, captions and music with a template renderer.
  3. Optional AI avatar or voice for faceless explainer videos.
- Publishing: start by copying the post manually, then connect the YouTube Data API and Meta (Facebook/Instagram) Graph API for direct scheduling.

### 3.5 Marketing Library (`/office/library`)
- Stored in Supabase Storage: logos, headshots, listing photos, flyers, one-pagers, pitch decks, video files.
- AI-generated flyers and one-pagers from templates for each brand.
- Tagged by business and campaign, and searchable.

### 3.6 Notebook / Ideas (`/office/notes`)
- A place to "organize my thoughts": free notes tagged by business.
- AI can **summarize**, **turn a note into tasks**, or **send an idea to the Factory** as a new internal project. Your own products (CemeteryBuilder etc.) are built with the same Factory you give clients.

### 3.7 Agents Desk (`/office/agents`)
- One page that lists every AI agent, what it did, what it costs (reuse `factory_agent_runs` / `factory_ai_models`) and what is **waiting for your approval** (posts, emails, plans).

## 4. Data model (Supabase, project `xqdsmbyealtammgmpsqe`)

New tables in `public`, prefixed `office_`, following the existing `factory_*` pattern. RLS allows access only to rows where the user is in `factory_admins`.

```
office_businesses      id, name, slug, kind, status(focus|active|parked), brand jsonb, weekly_focus text
office_goals           id, business_id, horizon(quarter|month|week), title, target, due_on, status
office_tasks           id, business_id, goal_id?, title, notes, due_on, estimate_min, priority, status, source(manual|ai|crm|studio), recurrence
office_daily_plans     id, plan_date, items jsonb[{task_id, reason, order}], reflection, created_by_agent_run
office_time_blocks     id, business_id, weekday, start, end      (weekly template)
office_contacts        id, name, email, phone, source, tags[], notes
office_companies       id, name, website, notes
office_contact_businesses  contact_id, business_id, role
office_pipelines       id, business_id, name, stages jsonb
office_deals           id, pipeline_id, contact_id, company_id?, stage, value, next_step, next_step_on, factory_project_id?
office_activities      id, contact_id?, deal_id?, kind(email|call|note|meeting|form), body, occurred_at, external_ref
office_content_items   id, business_id, channel[], format(reel|short|youtube|post|carousel|email|blog), status, idea, script, caption, assets jsonb, scheduled_at, published_url, metrics jsonb
office_assets          id, business_id, storage_path, kind, tags[], campaign
office_notes           id, business_id?, title, body, ai_summary, converted_task_ids uuid[]
office_approvals       id, kind(email|post|plan), payload jsonb, status, decided_at
```

Calendar events are not copied in. They are read live from the existing Google Calendar connection.

## 5. AI agents (server-side only, Claude via `@anthropic-ai/sdk`, same pattern as `app/lib/agents/spec-agent.ts`)

| Agent | Runs | Reads | Writes |
|---|---|---|---|
| **Daily Planner** | Vercel Cron, 6:45 am ET weekdays, or on demand | tasks, goals, deals, calendar, content calendar, yesterday's check-in | `office_daily_plans`, optional email to you |
| **Weekly Reviewer** | Sunday 6 pm ET | the week's completed work, every business's goals | draft weekly focus for each business (approval) |
| **Capture Sorter** | on each quick capture | the text | note or task with a business tag |
| **Follow-up Agent** | daily | deals with no activity for N days, Gmail threads | draft emails → `office_approvals` |
| **Content Writer** | on demand | brand kit, topic, format | script, caption, hashtags, shot list |
| **NCIssues Watcher** | daily during session | NCIssues bill data | draft posts and newsletter items |

Rules: every agent run is logged; **nothing goes outside (email, post) without your approval** until you turn on auto-publish for a channel.

## 6. Build phases

**Phase 0 — Restructure (½ week)**
- Add an `/office` layout with an admin gate (reuse `requireUser` + `factory_admins`) and side navigation.
- Main nav: "Factory" stays for clients; "Office" shows only for admins.
- Migration: `office_businesses` seeded with the businesses in §2.

**Phase 1 — Today and Tasks (1 week)** *← start here, it pays off on day one*
- Tables: goals, tasks, daily_plans, notes.
- Today screen, quick capture, a task list filtered by business.
- Daily Planner agent and a Vercel Cron job; read Google Calendar.

**Phase 2 — Schedule (½ week)**
- Week view with calendar events and time blocks, recurring duties, Weekly Reviewer.

**Phase 3 — CRM (1–1½ weeks)**
- Contacts, companies, pipelines and deals for each business, activity timeline, Gmail linking.
- Lead-intake endpoint for the three websites; "Convert to Factory project".
- Follow-up agent with an approval queue.

**Phase 4 — Content Studio (1½ weeks)**
- Content calendar, brand kits, the AI writers (reel, YouTube, repurpose, listing promo, NCIssues).
- Marketing Library on Supabase Storage.
- Manual publishing (copy or download) at first.

**Phase 5 — Publishing and Video (2 weeks, can be split)**
- YouTube and Meta API connections (same connection pattern as Google).
- Reel auto-assembly from templates; metrics pulled back into content items.

**Phase 6 — Agents Desk and polish**
- One page for agent runs, costs and approvals; phone-friendly layout so the Today screen works from the field.

## 7. Decisions needed from you

1. **Video:** scripts only first, or go straight to auto-assembled reels (template renderer such as Remotion), or AI avatar videos (paid service)?
2. **Social channels first:** which two? (Suggestion: Facebook + Instagram for real estate, YouTube for HUD education.)
3. **Daily brief delivery:** in-app only, or also an email/text each morning?
4. **Team access:** just you for now, or will an assistant or agents need logins with limited roles?
5. **Existing CRM data:** do you have contacts in another tool (spreadsheet, kvCORE, Follow Up Boss, etc.) to import?
6. **Database:** keep the Office in the same Supabase project as the Factory (simplest), or a separate project? (Suggestion: same project, separate `office_` tables and admin-only RLS.)
