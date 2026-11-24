"use client";

import { useEffect, useState } from "react";
import styles from "../office.module.css";
import { officePatch, officeRest } from "../lib/client";
import type { BillingProfile } from "./types";

type Status = { stripe: boolean; webhook: boolean; resend: boolean; site: string };

export function BillingSettings({ entityId, onError }: { entityId: string; onError: (m: string) => void }) {
  const [profile, setProfile] = useState<BillingProfile>({});
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    officeRest<{ legal_name: string; billing_profile: BillingProfile }[]>(`acct_entities?id=eq.${entityId}&select=legal_name,billing_profile`)
      .then((r) => { setProfile(r[0]?.billing_profile || {}); setName(r[0]?.legal_name || ""); }, (e) => onError(e instanceof Error ? e.message : "Could not load settings."));
    fetch("/api/office/billing/status").then((r) => r.json()).then(setStatus, () => setStatus(null));
  }, [entityId, onError]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      const clean = Object.fromEntries(Object.entries(profile).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]).filter(([, v]) => v !== "" && v != null));
      await officePatch("acct_entities", `id=eq.${entityId}`, { billing_profile: clean });
      setMsg("Saved. New invoices and the pay page use these details.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save.");
    }
  }
  const set = (k: keyof BillingProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setProfile({ ...profile, [k]: k === "payment_terms_days" ? Number(e.target.value) || 0 : e.target.value });

  return (
    <div className={styles.twoCol} style={{ marginTop: 0 }}>
      <form className={styles.card} onSubmit={save}>
        <h2>Invoice details</h2>
        <p className={styles.muted}>Printed on every invoice and quote from {name || "the LLC"}.</p>
        <label className={styles.field}>Business address<textarea rows={3} value={profile.address || ""} onChange={set("address")} placeholder={"Street\nCity, NC ZIP"} /></label>
        <div className={styles.formGrid}>
          <label className={styles.field}>Billing email<input type="email" value={profile.email || ""} onChange={set("email")} /></label>
          <label className={styles.field}>Phone<input value={profile.phone || ""} onChange={set("phone")} /></label>
        </div>
        <label className={styles.field}>Payment instructions<textarea rows={2} value={profile.payment_instructions || ""} onChange={set("payment_instructions")} placeholder="Pay online with the link, or mail a check to…" /></label>
        <label className={styles.field}>Footer<input value={profile.footer || ""} onChange={set("footer")} placeholder="Thank you for your business." /></label>
        <div className={styles.rowEnd}>{msg && <small className={styles.muted} role="status">{msg}</small>}<button className="button button-primary" type="submit">Save</button></div>
      </form>
      <article className={styles.card}>
        <h2>Setup</h2>
        <ul className={styles.plainList}>
          <li><strong>{status?.stripe ? "✓" : "✗"} Online payments (Stripe)</strong><small className={styles.muted}>{status?.stripe ? "Card and bank (ACH) payment, as switched on in your Stripe dashboard." : "Add STRIPE_SECRET_KEY in Vercel."}</small></li>
          <li><strong>{status?.webhook ? "✓" : "✗"} Payments marked paid automatically</strong>
            <small className={styles.muted}>{status?.webhook ? "Stripe webhook is set." : <>In Stripe → Developers → Webhooks, add <code>{status?.site || ""}/api/stripe/webhook</code> with the events checkout.session.completed, checkout.session.async_payment_succeeded and checkout.session.async_payment_failed, then save its signing secret as STRIPE_WEBHOOK_SECRET.</>}</small>
          </li>
          <li><strong>✓ Sending invoices</strong><small className={styles.muted}>From your connected Gmail (Factory → Connections){status?.resend ? ", or through Resend as a backup." : ". Add Resend (RESEND_API_KEY + OFFICE_BILLING_FROM) for automatic recurring emails."}</small></li>
          <li><strong>Books</strong><small className={styles.muted}>Invoices and payments post to the general ledger when Accounting (phase 4) is switched on.</small></li>
        </ul>
      </article>
    </div>
  );
}
