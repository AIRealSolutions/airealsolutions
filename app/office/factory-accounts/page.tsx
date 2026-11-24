import styles from "../office.module.css";
import AdminAccounts from "../../factory/admin/AdminAccounts";

export const metadata = { title: "Factory accounts & credits" };

export default function FactoryAccountsPage() {
  return (
    <section className={`${styles.page} ${styles.pageWide}`}>
      <header className={styles.pageHeader}>
        <span className="product-tag">Factory</span>
        <h1>Accounts &amp; credits</h1>
        <p>Factory customer accounts, promotion codes, incentive programs and manual credits. Credit grants stay in the ledger for auditability.</p>
      </header>
      <AdminAccounts embedded />
    </section>
  );
}
