# AI Real Solutions Back Office ("The Office") — Plan

**Date:** 2026-11-24 (rev. 2: added accounting, invoicing and billing, daily agenda, per-business goals, news feeds and reminders) · **Status:** Proposed, nothing built yet

## 1. The idea in one paragraph

AI Real Solutions (ARS) becomes the **hub** for every business you run. The site gets two separate halves:

| | **The Factory** (keep as is) | **The Office** (new) |
|---|---|---|
| Who uses it | Clients | You (and later staff, contractors or your CPA with limited access) |
| What it does | Takes a client from idea to a live product: onboarding, spec, build, preview, own infrastructure | Runs your companies: daily agenda, goals, reminders, news, schedule, CRM, accounting, invoicing, social media, marketing |
| Where | `/factory`, `/build` | `/office` (admin-only) |
| Data | `factory_*` tables, one org per client | `office_*` and `acct_*` tables, only you can read them |

The Factory stays the product you share with clients. The Office is the private desk where you organize your thoughts, see the money, and get a timed list of what to finish today for each company.

## 2. The businesses the Office manages

Each one is a **Business** record, and for accounting it is also an **Entity** with its own books (see §3.9). Everything else (goals, tasks, reminders, feed items, contacts, invoices, posts, notes) is tagged with one.

| Business | Type | Goals / feed / reminders examples |
|---|---|---|
| **AI Real Solutions** | Parent, software / AI | Monthly recurring revenue goal; feed: AI and dev-tool news; reminders: client renewals, Factory stage gates |
| **Lightkeeper Realty** | Brokerage | Closings per quarter; feed: SE NC market stats, rate news; reminders: license and CE renewal, closing dates, trust account reconciliation |
| **USAHUDHomes.com** | HUD referral | Referral fees per month; feed: new NC HUD listings, price cuts, bid-period changes; reminders: bid deadlines, referral fee follow-ups |
| **FindANCHome.com** | Local real estate | Leads per week; feed: new local listings, neighborhood news; reminders: showing follow-ups, open houses |
| **CemeteryBuilder.ai** | AI product | Pilot customers; feed: cemetery and funeral industry news, RFPs; reminders: demos, release milestones |
| **NCIssues.com** | Civic watchdog | Subscribers and posts per week; feed: NC General Assembly bill movements, committee calendars; reminders: votes and hearings |
| **VirtualClerk.ai, ElectionAgents.com, SignForge** | Products | Launch milestones; feed: municipal / election tech news, procurement bids |
| **Golf Buddy** | Side app | Low-priority maintenance |

Each business can be marked **Focus / Active / Parked**. That decides how many agenda slots, feed items and reminders it gets each day.

## 3. Office modules

### 3.1 Today: daily goal-setting agenda (home screen, `/office`)
The morning screen is an **agenda**, not just a list:

1. **Morning brief** (2-minute read): yesterday's wins, money in and out, overdue invoices, today's meetings, top news for each business.
2. **Today's 3 big goals:** the outcomes that move a weekly goal forward ("Submit HUD bid on 123 Oak St", "Send CemeteryBuilder proposal to Brunswick County").
3. **Time-blocked agenda:** each goal and task is placed into an open slot around your Google Calendar meetings, using each business's time blocks (e.g. 8–10 real estate, 10–12 CemeteryBuilder build, 1–2 admin and billing).
4. **Reminders due today** and **follow-ups** (CRM, invoices).
5. **Quick capture**: type or dictate; AI files it as a task, note, reminder, expense or contact.
6. **Evening check-in:** mark done, roll leftovers to tomorrow, a one-line reflection. The planner learns how long things really take you.

You can accept the AI agenda as is, drag things around, or say "lighter day" or "only real estate today" and it re-plans.

### 3.2 Goals: one tree for each business (`/office/goals`)
- Levels: **Year → Quarter → Month → Week → Day**. Every daily task traces up to a bigger goal.
- Goals can carry a **number** (e.g. "$15k referral fees this quarter"). The number updates itself from accounting, CRM or content data, so you see progress without entering it twice.
- Scorecard view: every business on one screen with on-track / at-risk / behind.
- The weekly review (Sunday) proposes next week's goals for each business, and you approve them.

### 3.3 Business feeds: news and activity (`/office/feed` and on each business page)
Each business gets its own **feed**, mixing outside news with inside activity:

- **Outside sources (set up for each business):** RSS feeds, Google News keyword searches, HUD HomeStore NC listings, NC General Assembly bill data (from NCIssues), procurement or RFP searches, competitor sites.
- **Inside events:** new lead, invoice paid, invoice overdue, deal moved stage, post published, Factory project stage change, agent finished a job.
- The **Feed Agent** summarizes and ranks items, drops duplicates and noise, and adds a "**Suggested action**" button that turns an item into a task, reminder or content idea ("New HUD listing in Leland under $150k → send to 3 buyer contacts").

### 3.4 Reminders system (`/office/reminders`)
- One-time and **recurring** reminders (daily, weekly, monthly, yearly, "the 1st business day", "10 days before X").
- **Created automatically** from other modules: task due dates, deal next-steps, invoice due or overdue, bill payments, tax deadlines, license renewals, HUD bid deadlines, legislative hearings, content publish times.
- Delivery: in-app always, plus **email** (Resend, already set up for auth), **text** (Twilio), and **phone push** (PWA), set by urgency.
- Snooze, done, or "turn into task". Escalation: an unacknowledged high-priority reminder is re-sent on another channel.
- A Vercel Cron job checks every 15 minutes and sends what is due.

### 3.5 Schedule (`/office/schedule`)
- A week view that combines Google Calendar events, time blocks for each business, and reminders.
- Recurring duties library: license and CE renewals, HUD bid periods, General Assembly session days, content days, month-end close, quarterly taxes.

### 3.6 CRM (`/office/crm`)
- **Contacts** and **Companies**, each tagged with one or more businesses.
- **Pipelines for each business:**
  - Real estate: Lead → Contacted → Showing → Offer → Under contract → Closed
  - HUD referral: Referral in → Bid prep → Bid submitted → Accepted → Closed → **Referral fee invoiced → Paid**
  - Software: Lead → Discovery → Proposal → Factory project → Live → **Subscription active**
- An activity timeline (Gmail, calls, notes, meetings); a follow-up agent drafts emails for you to approve.
- Lead intake from airealsolutions.com, findanchome.com and usahudhomes.com.
- **Linked to billing:** a closed deal can create an invoice or start a subscription in one click.

### 3.7 Invoicing and Billing (`/office/billing`)
- **Customers** (linked to CRM contacts and companies) for each business.
- **Products and price list** for each business: Factory plans and add-ons (already in `factory_plans` / `factory_addons`), consulting hours, setup fees, CemeteryBuilder licenses, referral fees.
- **Quotes / estimates → invoices**, with branded PDFs for each business (logo, address, payment terms).
- **Recurring billing / subscriptions** for SaaS and retainers, joining Factory subscriptions to their invoices.
- **Online payment** through **Stripe** (card and ACH), with a pay link on every invoice; Stripe webhooks mark invoices paid and post them to the books automatically.
- **Payment tracking:** partial payments, credits, refunds, write-offs; checks and wires entered by hand.
- **Dunning:** automatic friendly reminders at due date, +7, +14 and +30 days, plus an overdue list in the morning brief.
- **Commission and referral tracking** for real estate: expected commission on each deal, splits, referral fees owed to and from USAHUDHomes partners, and 1099 totals for each payee.
- Time tracking (optional): log hours on a client or Factory project, then bill the unbilled time.

### 3.8 Expenses and Bills (`/office/expenses`)
- **Bills** you owe (vendors, MLS dues, software, hosting). Each gets due-date reminders and a "mark paid" button.
- **Receipt capture:** snap a photo or forward an email. AI reads the vendor, amount, date and category, and suggests the business and account.
- Mileage log for showings (an IRS mileage rate setting you update each year).
- Recurring expenses detected from bank feeds (Vercel, Supabase, Anthropic, GoDaddy, etc.).

### 3.9 Accounting: full books (`/office/accounting`)
A real **double-entry general ledger**, kept **separately for each entity** with a combined (consolidated) view:

- **Chart of accounts** for each entity, starting from templates (service business, real estate brokerage, SaaS).
- **Journal entries:** every invoice, payment, bill, expense, payout and transfer posts balanced debits and credits. Manual journal entries are also allowed.
- **Bank and card feeds** (Plaid) with **reconciliation**: match transactions to invoices, bills or rules, and AI suggests categories.
- **Inter-company transactions:** e.g. ARS builds CemeteryBuilder's software, or Lightkeeper pays ARS for its website. Recorded as due-to / due-from between entities.
- **Reports** for each entity and combined: Profit and Loss, Balance Sheet, Cash Flow, AR aging, AP aging, sales by customer, expenses by category, budget vs actual (tied to Goals), 1099 summary.
- **Period close:** a month-end checklist (reconcile banks, review uncategorized items, lock the period).
- **Tax prep support:** quarterly estimated tax reminders, NC and federal deadline calendar, and **exports for your CPA** (CSV, plus QuickBooks-compatible files).
- **Real estate trust / escrow:** the NC Real Estate Commission has strict trust account rules. The Office **tracks and reconciles** trust deposits (earnest money) in a separate trust ledger and reminds you about the reconciliation, but it does **not** move trust money. Confirm the setup with your CPA and the NCREC rules.
- **Audit trail:** every change is logged; posted entries are reversed, never deleted.
- **Accountant role:** a read-only (or bookkeeper) login for your CPA.

> Accounting should be checked by your CPA before you rely on it for tax filing. The plan includes a CPA-ready export so they can work in their own tools.

### 3.10 Content Studio: social media and video (`/office/studio`)
- A content calendar across businesses and channels (Facebook, Instagram, YouTube, TikTok, LinkedIn, X).
- **Idea → Script → Assets → Scheduled → Published → Results** pipeline for each piece.
- AI writers: Reels/Shorts, YouTube planner, Repurposer, NCIssues bill-to-post, listing promo.
- Brand kits for each business; Equal Housing and broker disclosures added to real estate content.
- Video in stages: (1) scripts and shot lists, (2) auto-assembled reels from templates, (3) optional AI avatar or voice.
- Publishing: copy by hand first, then the YouTube Data API and Meta Graph API.

### 3.11 Marketing Library, Notebook, Agents Desk
- **Library:** logos, photos, flyers, decks and video in Supabase Storage, tagged by business and campaign.
- **Notebook:** free notes for each business; AI summarizes, turns a note into tasks, or **sends an idea to the Factory**.
- **Agents Desk:** every agent run, what it cost (reuses `factory_agent_runs` / `factory_ai_models`), and the **approval queue** (emails, posts, invoices, journal entries proposed by AI).

## 4. Data model (Supabase, project `xqdsmbyealtammgmpsqe`)

New tables in `public`, following the existing `factory_*` pattern. RLS allows access only to `factory_admins`; a later `office_roles` table adds limited roles (assistant, bookkeeper/CPA).

**Core and planning**
```
office_businesses      id, name, slug, kind, status(focus|active|parked), brand jsonb, weekly_focus, entity_id
office_goals           id, business_id, parent_id, level(year|quarter|month|week|day), title, metric_key?, target_value, current_value, due_on, status
office_tasks           id, business_id, goal_id?, title, notes, due_on, estimate_min, priority, status, source, recurrence
office_daily_plans     id, plan_date, brief jsonb, agenda jsonb[{slot_start, slot_end, task_id|event_id, reason}], reflection, agent_run_id
office_time_blocks     id, business_id, weekday, start_time, end_time
office_reminders       id, business_id?, title, due_at, rrule?, channels text[], priority, status(pending|sent|snoozed|done), source_type, source_id, last_sent_at
office_feed_sources    id, business_id, kind(rss|google_news|hud|ncga|rfp|url), config jsonb, active
office_feed_items      id, business_id, source_id?, kind(news|internal), title, url, summary, score, suggested_action jsonb, status(new|seen|actioned|dismissed), published_at
office_notes           id, business_id?, title, body, ai_summary, converted_task_ids uuid[]
office_approvals       id, kind(email|post|plan|invoice|journal), payload jsonb, status, decided_at
```

**CRM and content**
```
office_contacts, office_companies, office_contact_businesses
office_pipelines       id, business_id, name, stages jsonb
office_deals           id, pipeline_id, contact_id, company_id?, stage, value, expected_commission, next_step, next_step_on, factory_project_id?
office_activities      id, contact_id?, deal_id?, kind, body, occurred_at, external_ref
office_content_items   id, business_id, channel[], format, status, idea, script, caption, assets jsonb, scheduled_at, published_url, metrics jsonb
office_assets          id, business_id, storage_path, kind, tags[], campaign
```

**Billing**
```
bill_customers         id, entity_id, contact_id?, company_id?, name, email, billing_address jsonb, stripe_customer_id
bill_products          id, entity_id, name, unit_price, unit, income_account_id, recurring_interval?
bill_quotes            id, entity_id, customer_id, number, status, lines jsonb, total, valid_until
bill_invoices          id, entity_id, customer_id, number, status(draft|sent|partial|paid|overdue|void), issue_date, due_date, subtotal, tax, total, balance, stripe_invoice_id, pdf_path, deal_id?, factory_project_id?
bill_invoice_lines     id, invoice_id, product_id?, description, qty, unit_price, amount, account_id
bill_payments          id, entity_id, customer_id, invoice_id?, amount, method(stripe|ach|check|wire|cash), received_on, stripe_payment_id
bill_subscriptions     id, entity_id, customer_id, product_id, status, interval, next_bill_on, stripe_subscription_id, factory_subscription_id?
bill_time_entries      id, entity_id, customer_id, project_ref, minutes, rate, billed_invoice_id?
bill_commissions       id, deal_id, gross, split jsonb, referral_fee, payee, status
```

**Accounting**
```
acct_entities          id, legal_name, ein_last4, fiscal_year_start, base_currency, parent_entity_id?
acct_accounts          id, entity_id, code, name, type(asset|liability|equity|income|expense), subtype, is_trust, parent_id, active
acct_journal_entries   id, entity_id, entry_date, memo, source_type(invoice|payment|bill|expense|bank|manual|intercompany), source_id, status(draft|posted|reversed), period_locked
acct_journal_lines     id, entry_id, account_id, debit, credit, business_id?, contact_id?, memo   -- trigger: sum(debit)=sum(credit) per entry
acct_bank_accounts     id, entity_id, account_id, plaid_item_ref (encrypted), mask, kind, is_trust
acct_bank_txns         id, bank_account_id, posted_on, amount, description, plaid_txn_id, match_status, matched_entry_id
acct_rules             id, entity_id, match jsonb, account_id, business_id
acct_bills             id, entity_id, vendor, bill_date, due_date, total, status, expense_account_id, receipt_path
acct_expenses          id, entity_id, business_id, paid_on, vendor, amount, account_id, receipt_path, mileage_miles?
acct_periods           id, entity_id, period_start, period_end, status(open|closed)
acct_audit_log         id, table_name, row_id, action, before jsonb, after jsonb, actor_id, at
```
Reports (P&L, balance sheet, aging) are **Postgres views or functions** on top of `acct_journal_lines`, so every screen uses the same numbers.

## 5. AI agents (server-side only, Claude via `@anthropic-ai/sdk`, same pattern as `app/lib/agents/spec-agent.ts`)

| Agent | Runs | Does | Needs approval? |
|---|---|---|---|
| **Daily Planner** | 6:45 am ET weekdays + on demand | Morning brief, 3 big goals, time-blocked agenda | No (you can re-plan) |
| **Weekly Reviewer** | Sunday 6 pm ET | Scores goals, drafts next week's goals for each business | Yes |
| **Feed Agent** | Every few hours | Pulls sources, summarizes, ranks, suggests actions | No (suggestions only) |
| **Reminder Engine** | Every 15 min (code, not LLM) | Sends due reminders, escalates | — |
| **Capture Sorter** | Each quick capture | Files text or voice as task, note, reminder, expense or contact | No |
| **Follow-up Agent** | Daily | Drafts follow-up emails for quiet deals | Yes |
| **Collections Agent** | Daily | Drafts overdue invoice reminders, flags risky accounts | Yes (or auto after you turn it on) |
| **Bookkeeper Agent** | On new bank transactions and receipts | Categorizes, matches to invoices or bills, reads receipts, proposes journal entries | Yes, until rules are trusted |
| **Finance Brief** | Weekly + month-end | Cash position, P&L trend, unusual spending, tax reminders | No |
| **Content Writer / NCIssues Watcher** | On demand / daily during session | Scripts, captions, bill posts | Yes |

**Rule:** AI never sends money, sends email, publishes posts or posts journal entries without approval until you turn on auto mode for that action.

## 6. Build phases (updated)

**Phase 0 — Restructure (½ week)**
`/office` layout with an admin gate (reuse `requireUser` + `factory_admins`) and side navigation; "Office" in the nav for admins only; seed businesses and entities.

**Phase 1 — Today agenda, Goals, Tasks, Reminders (1½ weeks)** *← start here*
Goal tree, tasks, daily plans, reminders (in-app + email), Daily Planner, a Vercel Cron job, Google Calendar time-blocking, quick capture.

**Phase 2 — Business feeds and Schedule (1 week)**
Feed sources for each business (RSS, Google News, HUD NC listings, NCGA bills), Feed Agent with suggested actions, week view, recurring duties, Weekly Reviewer.

**Phase 3 — Invoicing and Billing (1½ weeks)**
Customers, products, quotes, invoices, branded PDFs, Stripe pay links and webhooks, recurring billing, dunning, Collections Agent. *This starts posting to a simple ledger.*

**Phase 4 — Accounting core (2–3 weeks)**
Entities, chart of accounts, double-entry journal with a balance check, bills and expenses, receipt capture, Plaid bank feeds, reconciliation, Bookkeeper Agent, P&L / balance sheet / aging reports, period close, CPA export, trust ledger tracking.

**Phase 5 — CRM (1–1½ weeks)**
Contacts, pipelines for each business, Gmail timeline, lead intake from the three sites, deal → invoice / subscription / Factory project, commissions and referral fees.

**Phase 6 — Content Studio and Library (1½ weeks)**, then **Phase 7 — Publishing and Video (2 weeks)**

**Phase 8 — Agents Desk, roles (assistant, CPA), text messages and phone push, phone-friendly polish**

Total for phases 0–5 is about 9–11 weeks of build time. Each phase can be used on its own.

## 7. Decisions needed from you

1. **Accounting approach (the biggest one):**
   - **A. Build the books in the Office** (own ledger + Stripe + Plaid + CPA export). Full control and all in one place, but more work, and your CPA needs to sign off. *← recommended if you want everything in one hub*
   - **B. Sync with QuickBooks Online.** The Office does invoices, goals and agenda, and QuickBooks keeps the official books. Less risk and CPA-friendly, but a second system and a monthly fee.
2. **Entities:** which businesses are separate LLCs or EINs with their own bank accounts, and which share books?
3. **Payments:** OK to use **Stripe** for invoices and subscriptions, and **Plaid** for bank feeds (both have monthly or per-transaction fees)?
4. **Real estate money:** does Lightkeeper hold earnest money in a trust account? (This decides whether the trust ledger is needed in phase 4.)
5. **Reminder channels:** email only, or also text (Twilio, small monthly cost) and phone push?
6. **News sources:** any specific sites or keywords for each business you already watch?
7. Earlier questions still open: video approach, first two social channels, morning brief delivery, team/CPA access, existing contacts to import, same Supabase project (recommended).
