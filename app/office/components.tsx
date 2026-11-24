"use client";

import styles from "./office.module.css";
import type { Business } from "./lib/client";

/** Small label with the business name; colored by Focus / Active / Parked. */
export function BizTag({ business }: { business: Business | undefined | null }) {
  if (!business) return null;
  return <span className={`${styles.tag} ${styles[`tag_${business.status}`]}`}>{business.name}</span>;
}

export function BusinessSelect({
  businesses, value, onChange, allowNone = true, noneLabel = "No business", label = "Business", disabled = false,
}: {
  businesses: Business[]; value: string; onChange: (v: string) => void; allowNone?: boolean; noneLabel?: string; label?: string; disabled?: boolean;
}) {
  const groups: [string, Business["relationship"][]][] = [["AI Real Solutions & ventures", ["parent", "venture"]], ["Clients", ["client"]]];
  return (
    <label className={styles.field}>
      {label}
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {allowNone && <option value="">{noneLabel}</option>}
        {groups.map(([name, rels]) => (
          <optgroup key={name} label={name}>
            {businesses.filter((b) => rels.includes(b.relationship)).map((b) => (
              <option key={b.id} value={b.id}>{b.name}{b.status === "parked" ? " (parked)" : ""}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export function PriorityDot({ p }: { p: 1 | 2 | 3 }) {
  const label = p === 1 ? "High priority" : p === 3 ? "Low priority" : "Normal priority";
  return <span className={`${styles.prio} ${styles[`prio${p}`]}`} title={label} aria-label={label} />;
}

export function ErrorBox({ message }: { message: string }) {
  return message ? <div className={styles.alert} role="alert">{message}</div> : null;
}
