// The Office's sections, in side-nav order. `phase` matches docs/back-office-plan.md §6.
// `ready` sections have their own page; the rest render the "coming in phase N" page at /office/[module].
export type OfficeModule = {
  slug: string;
  label: string;
  group: "Plan" | "Run" | "Money" | "Grow";
  phase: number;
  ready: boolean;
  summary: string;
  bullets: string[];
};

export const OFFICE_MODULES: OfficeModule[] = [
  { slug: "", label: "Today", group: "Plan", phase: 1, ready: true,
    summary: "Your daily goal-setting agenda.",
    bullets: ["Morning brief", "3 big goals for the day", "Time-blocked agenda around your calendar", "Quick capture and evening check-in"] },
  { slug: "businesses", label: "Businesses", group: "Plan", phase: 0, ready: true,
    summary: "AI Real Solutions LLC, its ventures and its clients.",
    bullets: [] },
  { slug: "goals", label: "Goals", group: "Plan", phase: 1, ready: true,
    summary: "A goal tree for each business: year → quarter → month → week → day.",
    bullets: ["Every task traces up to a bigger goal", "Goals with numbers update themselves from billing and accounting", "Scorecard: on track, at risk, behind"] },
  { slug: "tasks", label: "Tasks", group: "Plan", phase: 1, ready: true,
    summary: "Every task for every business, filtered and prioritized.",
    bullets: ["Due dates, estimates, priority", "Recurring tasks", "Created by you, AI capture, CRM or the Content Studio"] },
  { slug: "reminders", label: "Reminders", group: "Plan", phase: 1, ready: true,
    summary: "One-time and recurring reminders, many created on their own.",
    bullets: ["In-app and email first, text and phone push later", "Created from due dates, invoices, bills and tax deadlines", "Snooze, done, or turn into a task"] },
  { slug: "feed", label: "Feed", group: "Run", phase: 2, ready: true,
    summary: "News and activity for each business, ranked by AI.",
    bullets: ["RSS, news searches, NC General Assembly bills, RFPs", "Internal events: invoice paid, lead in, project stage change", "One click turns an item into a task, reminder or post"] },
  { slug: "schedule", label: "Schedule", group: "Run", phase: 2, ready: true,
    summary: "Week view: Google Calendar plus time blocks for each business.",
    bullets: ["Recurring duties library", "Sunday weekly review"] },
  { slug: "crm", label: "CRM", group: "Run", phase: 5, ready: false,
    summary: "Clients and prospects for AI Real Solutions and its ventures.",
    bullets: ["Pipelines: Lead → Discovery → Proposal → Factory project → Live", "Gmail timeline", "Won deal → invoice, subscription or Factory project"] },
  { slug: "billing", label: "Invoicing & Billing", group: "Money", phase: 3, ready: true,
    summary: "Quotes, invoices, subscriptions and payments.",
    bullets: ["Branded invoice PDFs", "Stripe card and ACH pay links", "Recurring billing and overdue reminders"] },
  { slug: "expenses", label: "Expenses & Bills", group: "Money", phase: 4, ready: true,
    summary: "What the LLC owes and spends.",
    bullets: ["Bills with due-date reminders", "Receipt capture read by AI", "Recurring software and hosting costs"] },
  { slug: "accounting", label: "Accounting", group: "Money", phase: 4, ready: true,
    summary: "Full double-entry books for AI Real Solutions LLC.",
    bullets: ["Chart of accounts and journal", "Bank feeds and reconciliation", "P&L, balance sheet, cash flow, AR/AP aging", "Each venture and client tracked as its own line", "Month-end close and CPA export"] },
  { slug: "studio", label: "Content Studio", group: "Grow", phase: 6, ready: false,
    summary: "Social media, reels and YouTube for every brand.",
    bullets: ["Content calendar", "AI scripts, captions and shot lists", "Brand kit for each business"] },
  { slug: "library", label: "Library", group: "Grow", phase: 6, ready: false,
    summary: "Logos, photos, flyers, decks and video.",
    bullets: ["Tagged by business and campaign", "AI-made flyers and one-pagers"] },
  { slug: "notes", label: "Notebook", group: "Grow", phase: 1, ready: true,
    summary: "A place to organize your thoughts.",
    bullets: ["Notes for each business", "AI summarize, turn into tasks, or send to the Factory"] },
  { slug: "agents", label: "Agents Desk", group: "Grow", phase: 8, ready: false,
    summary: "Every AI agent's work, cost and approval queue.",
    bullets: ["Nothing goes out without your approval"] },
];

export const upcomingModules = () => OFFICE_MODULES.filter((m) => !m.ready);
export const findModule = (slug: string) => OFFICE_MODULES.find((m) => m.slug === slug);
