// Public invoice lookups by unguessable token (for the /pay page and its actions). Server-only; uses the service role.
import { asService } from "./server";
import type { InvoiceRow, LineRow, Seller } from "./billing";

export const TOKEN = /^[0-9a-f]{64}$/;

export type PublicInvoice = InvoiceRow & {
  bill_customers: { name: string; email: string | null; billing_address: string | null } | null;
  office_businesses: { name: string; website: string | null } | null;
  acct_entities: Seller | null;
  bill_invoice_lines: LineRow[];
};

export async function loadPublicInvoice(token: string): Promise<PublicInvoice | null> {
  if (!TOKEN.test(token)) return null;
  const rows = await asService()<PublicInvoice[]>(
    `bill_invoices?public_token=eq.${token}&status=neq.draft&select=id,entity_id,customer_id,business_id,kind,number,status,issue_date,due_date,memo,subtotal_cents,tax_cents,total_cents,paid_cents,balance_cents,public_token,dunning_stage,` +
      "bill_customers(name,email,billing_address),office_businesses(name,website),acct_entities(legal_name,billing_profile),bill_invoice_lines(description,quantity,unit_price_cents,amount_cents,sort_order)&limit=1",
  );
  const inv = rows[0];
  if (!inv) return null;
  inv.bill_invoice_lines = [...(inv.bill_invoice_lines || [])].sort((a, b) => ((a as { sort_order?: number }).sort_order ?? 0) - ((b as { sort_order?: number }).sort_order ?? 0));
  return inv;
}
