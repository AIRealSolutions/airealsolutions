"use client";
// Investor one-pager on the preview: built in the database (private.factory_preview_summary) from the approved
// Product Synthesis and, when the link allows it, the economics numbers.
import styles from "./preview.module.css";

export type Summary = {
  synthesis: Partial<{
    product_summary: string;
    problem_statement: string;
    desired_outcomes: string[];
    users_and_roles: string[];
    requirements: string[];
    automation_opportunities: string[];
    integrations: string[];
    build_sequence: string[];
  }>;
  numbers: Partial<{
    pricing_model: string;
    setup_price: number;
    monthly_price: number;
    target_customers: number;
    target_mrr: number;
    monthly_operating_cost: number;
    break_even_customers: number;
    build_cost: number;
    customer_value_monthly: number;
    hours_saved_monthly: number;
  }> | null;
};

const money = (n: number | undefined) =>
  n == null ? null : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Number(n) % 1 ? 2 : 0 });
const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && Boolean(x.trim())) : []);

export default function InvestorSummary({ name, summary, preparedFor }: { name: string; summary: Summary; preparedFor: string | null }) {
  const s = summary.synthesis || {};
  const n = summary.numbers;
  const features = arr(s.requirements).filter((r) => !/^later:/i.test(r)).slice(0, 8);
  const later = arr(s.requirements).filter((r) => /^later:/i.test(r)).map((r) => r.replace(/^later:\s*/i, "")).slice(0, 6);

  const stats = n
    ? ([
        ["Monthly price", money(n.monthly_price)],
        ["Setup price", money(n.setup_price)],
        ["Target customers", n.target_customers != null ? Number(n.target_customers).toLocaleString() : null],
        ["Monthly revenue at target", money(n.target_mrr)],
        ["Monthly running cost", money(n.monthly_operating_cost)],
        ["Customers to break even", n.break_even_customers != null ? Number(n.break_even_customers).toLocaleString() : null],
        ["Estimated build cost", money(n.build_cost)],
        ["Value to each customer", n.customer_value_monthly != null ? `${money(n.customer_value_monthly)}/mo` : null],
        ["Hours saved per customer", n.hours_saved_monthly != null ? `${n.hours_saved_monthly}/mo` : null],
      ].filter(([, v]) => v) as [string, string][])
    : [];

  return (
    <article className={styles.summary}>
      <header>
        <p className={styles.kicker}>Investor summary{preparedFor ? ` · prepared for ${preparedFor}` : ""}</p>
        <h1>{name}</h1>
        {s.product_summary && <p className={styles.lead}>{s.product_summary}</p>}
        <button type="button" className={styles.linkButton} onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </header>

      {s.problem_statement && (
        <section>
          <h2>The problem</h2>
          <p>{s.problem_statement}</p>
        </section>
      )}

      {stats.length > 0 && (
        <section>
          <h2>The numbers</h2>
          {n?.pricing_model && <p>Pricing model: {label(n.pricing_model)}</p>}
          <div className={styles.stats}>
            {stats.map(([k, v]) => (
              <div key={k}>
                <strong>{v}</strong>
                <span>{k}</span>
              </div>
            ))}
          </div>
          <p className={styles.note}>Targets and estimates from the project’s economics plan, not results.</p>
        </section>
      )}

      <div className={styles.summaryGrid}>
        <List title="Who it is for" items={arr(s.users_and_roles)} />
        <List title="What it changes" items={arr(s.desired_outcomes)} />
        <List title="What the first version does" items={features} />
        <List title="Work it automates" items={arr(s.automation_opportunities)} />
        <List title="Connects with" items={arr(s.integrations)} />
        <List title="Planned next" items={later} />
      </div>

      {arr(s.build_sequence).length > 0 && (
        <section>
          <h2>Road to launch</h2>
          <ol className={styles.steps}>
            {arr(s.build_sequence).map((step, i) => (
              <li key={i}>
                <b>{i + 1}</b>
                <span>
                  <strong>{step}</strong>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className={styles.note}>
        This prototype and summary were produced by the AI Real Solutions Factory from the founder’s onboarding. The prototype uses demo data; it is not the finished product.
      </p>
    </article>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className={styles.card}>
      <h3>{title}</h3>
      <ul>
        {items.slice(0, 8).map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </section>
  );
}
