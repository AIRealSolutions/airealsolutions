// Client-side billing types and helpers.
export type Customer = { id: string; entity_id: string; business_id: string | null; name: string; email: string | null; phone: string | null; billing_address: string | null; notes: string | null; active: boolean };
export type Product = { id: string; entity_id: string; business_id: string | null; name: string; description: string | null; unit_price_cents: number; unit: string; recurring_interval: "month" | "year" | null; active: boolean };
export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "void" | "accepted" | "declined" | "expired";
export type Invoice = {
  id: string; entity_id: string; customer_id: string; business_id: string | null; kind: "invoice" | "quote"; number: string; status: InvoiceStatus;
  issue_date: string; due_date: string | null; memo: string | null; subtotal_cents: number; tax_cents: number; total_cents: number;
  paid_cents: number; balance_cents: number; public_token: string; sent_at: string | null; paid_at: string | null; converted_from: string | null; subscription_id: string | null;
};
export type Line = { id?: string; product_id: string | null; description: string; quantity: number; unit_price_cents: number; amount_cents?: number; sort_order?: number };
export type Payment = { id: string; amount_cents: number; method: string; received_on: string; reference: string | null; notes: string | null };
export type SubLine = { product_id: string | null; description: string; quantity: number; unit_price_cents: number };
export type Subscription = { id: string; entity_id: string; customer_id: string; business_id: string | null; name: string; interval: "month" | "year"; next_invoice_on: string; days_until_due: number; lines: SubLine[]; auto_send: boolean; status: "active" | "paused" | "canceled" };
export type BillingProfile = { address?: string; email?: string; phone?: string; payment_terms_days?: number; payment_instructions?: string; footer?: string };

export const INVOICE_SELECT = "id,entity_id,customer_id,business_id,kind,number,status,issue_date,due_date,memo,subtotal_cents,tax_cents,total_cents,paid_cents,balance_cents,public_token,sent_at,paid_at,converted_from,subscription_id";
export const CUSTOMER_SELECT = "id,entity_id,business_id,name,email,phone,billing_address,notes,active";
export const PRODUCT_SELECT = "id,entity_id,business_id,name,description,unit_price_cents,unit,recurring_interval,active";

export const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
/** "1,250.5" -> 125050. Returns null when not a valid non-negative amount. */
export const toCents = (v: string): number | null => {
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
export const dollars = (cents: number) => ((cents || 0) / 100).toFixed(2);

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft", sent: "Sent", partial: "Partly paid", paid: "Paid", void: "Void", accepted: "Accepted", declined: "Declined", expired: "Expired",
};
export const payUrl = (token: string) => `${typeof window === "undefined" ? "" : window.location.origin}/pay/${token}`;
