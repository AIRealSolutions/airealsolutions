export type Stage = { key: string; label: string; kind: "open" | "won" | "lost" };
export type Pipeline = { id: string; business_id: string | null; name: string; stages: Stage[]; sort_order: number };
export type Company = { id: string; name: string; website: string | null; phone: string | null; notes: string | null; bill_customer_id: string | null };
export type Contact = { id: string; name: string; email: string | null; phone: string | null; title: string | null; company_id: string | null; notes: string | null; source: string | null; last_contacted_at: string | null; created_at: string };
export type Deal = {
  id: string; pipeline_id: string; business_id: string | null; title: string; contact_id: string | null; company_id: string | null; stage: string; status: "open" | "won" | "lost";
  value_cents: number; recurring_cents: number; expected_close: string | null; next_step: string | null; next_step_on: string | null; lost_reason: string | null; source: string | null;
  invoice_id: string | null; factory_project_id: string | null; last_activity_at: string | null; closed_at: string | null; created_at: string;
};
export type Activity = { id: string; contact_id: string | null; company_id: string | null; deal_id: string | null; kind: "note" | "call" | "email" | "meeting" | "form" | "task"; direction: "in" | "out" | null; subject: string | null; body: string | null; occurred_at: string };
export type ContactBusiness = { contact_id: string; business_id: string; role: string };

export const CONTACT_SELECT = "id,name,email,phone,title,company_id,notes,source,last_contacted_at,created_at";
export const DEAL_SELECT = "id,pipeline_id,business_id,title,contact_id,company_id,stage,status,value_cents,recurring_cents,expected_close,next_step,next_step_on,lost_reason,source,invoice_id,factory_project_id,last_activity_at,closed_at,created_at";
export const KIND_ICON: Record<Activity["kind"], string> = { note: "📝", call: "📞", email: "✉️", meeting: "🤝", form: "📨", task: "✅" };
export const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format((cents || 0) / 100);
export const toCents = (v: string): number | null => { const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
