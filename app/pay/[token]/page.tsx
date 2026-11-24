import type { Metadata } from "next";
import { notFound } from "next/navigation";
import styles from "./pay.module.css";
import PrintButton from "./PrintButton";
import { money, stripeConfigured } from "../../lib/office/billing";
import { loadPublicInvoice } from "../../lib/office/pay";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoice", robots: { index: false, follow: false } };

const fmt = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

export default async function PayPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ token }, q] = await Promise.all([params, searchParams]);
  const inv = await loadPublicInvoice(token).catch((e) => { console.error("[pay] load failed", e); return null; });
  if (!inv) notFound();

  const seller = inv.acct_entities;
  const profile = seller?.billing_profile || {};
  const brand = inv.office_businesses?.name || seller?.legal_name || "AI Real Solutions";
  const isQuote = inv.kind === "quote";
  const open = !isQuote && (inv.status === "sent" || inv.status === "partial") && inv.balance_cents > 0;
  const statusLabel: Record<string, string> = { sent: "Due", partial: "Partly paid", paid: "Paid", void: "Void", accepted: "Accepted", declined: "Declined", expired: "Expired" };

  return (
    <main className={styles.wrap}>
      <article className={styles.sheet}>
        <header className={styles.head}>
          <div>
            <p className={styles.brand}>{brand}</p>
            {brand !== seller?.legal_name && <p className={styles.small}>{seller?.legal_name}</p>}
            {profile.address && <p className={`${styles.small} ${styles.pre}`}>{profile.address}</p>}
            <p className={styles.small}>{[profile.email, profile.phone].filter(Boolean).join(" · ")}</p>
          </div>
          <div className={styles.right}>
            <h1>{isQuote ? "Quote" : "Invoice"}</h1>
            <p className={styles.number}>{inv.number}</p>
            <span className={`${styles.status} ${styles[`st_${inv.status}`] || ""}`}>{statusLabel[inv.status] || inv.status}</span>
          </div>
        </header>

        {q.paid && <p className={styles.ok}>Thank you. Your payment was received; bank payments can take a few days to clear and show here.</p>}
        {q.accepted && <p className={styles.ok}>Thank you for accepting this quote. We will be in touch to get started.</p>}
        {q.error && <p className={styles.err}>{q.error}</p>}

        <section className={styles.meta}>
          <div>
            <p className={styles.label}>{isQuote ? "Prepared for" : "Bill to"}</p>
            <p><strong>{inv.bill_customers?.name}</strong></p>
            {inv.bill_customers?.billing_address && <p className={`${styles.small} ${styles.pre}`}>{inv.bill_customers.billing_address}</p>}
          </div>
          <div>
            <p className={styles.label}>Issued</p><p>{fmt(inv.issue_date)}</p>
            {inv.due_date && <><p className={styles.label}>{isQuote ? "Valid until" : "Due"}</p><p>{fmt(inv.due_date)}</p></>}
          </div>
        </section>

        <table className={styles.lines}>
          <thead><tr><th>Description</th><th className={styles.num}>Qty</th><th className={styles.num}>Price</th><th className={styles.num}>Amount</th></tr></thead>
          <tbody>
            {inv.bill_invoice_lines.map((l, i) => (
              <tr key={i}><td>{l.description}</td><td className={styles.num}>{Number(l.quantity)}</td><td className={styles.num}>{money(l.unit_price_cents)}</td><td className={styles.num}>{money(l.amount_cents)}</td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}>Subtotal</td><td className={styles.num}>{money(inv.subtotal_cents)}</td></tr>
            {inv.tax_cents > 0 && <tr><td colSpan={3}>Tax</td><td className={styles.num}>{money(inv.tax_cents)}</td></tr>}
            <tr className={styles.total}><td colSpan={3}>Total</td><td className={styles.num}>{money(inv.total_cents)}</td></tr>
            {inv.paid_cents > 0 && <tr><td colSpan={3}>Paid</td><td className={styles.num}>−{money(inv.paid_cents)}</td></tr>}
            {!isQuote && <tr className={styles.total}><td colSpan={3}>Balance due</td><td className={styles.num}>{money(inv.balance_cents)}</td></tr>}
          </tfoot>
        </table>

        {inv.memo && <p className={`${styles.memo} ${styles.pre}`}>{inv.memo}</p>}

        <div className={styles.actions}>
          {open && stripeConfigured() && (
            <form action={`/api/pay/${inv.public_token}/checkout`} method="post"><button className={styles.pay} type="submit">Pay {money(inv.balance_cents)} online</button></form>
          )}
          {isQuote && inv.status === "sent" && (
            <form action={`/api/pay/${inv.public_token}/accept`} method="post"><button className={styles.pay} type="submit">Accept quote</button></form>
          )}
          <PrintButton />
        </div>
        {open && (profile.payment_instructions || !stripeConfigured()) && (
          <p className={`${styles.small} ${styles.pre}`}>{profile.payment_instructions || "Please contact us for payment options."}</p>
        )}
        {profile.footer && <p className={`${styles.small} ${styles.pre}`}>{profile.footer}</p>}
      </article>
    </main>
  );
}
