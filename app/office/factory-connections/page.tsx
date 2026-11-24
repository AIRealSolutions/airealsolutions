import styles from "../office.module.css";
import ConnectionsPanel from "../../factory/connections/ConnectionsPanel";
import ReturnHere from "./ReturnHere";

export const metadata = { title: "Connections" };

export default function FactoryConnectionsPage() {
  return (
    <section className={`${styles.page} ${styles.pageWide}`}>
      <header className={styles.pageHeader}>
        <span className="product-tag">Factory</span>
        <h1>Connections</h1>
        <p>Your Google account (Gmail and Calendar, used by the daily planner, CRM and invoices) and the GitHub, Vercel and Supabase accounts the Factory uses to build and ship projects.</p>
      </header>
      <ReturnHere />
      <ConnectionsPanel embedded />
    </section>
  );
}
