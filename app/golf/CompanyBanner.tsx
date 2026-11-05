import { COMPANIES } from "./lib/companies";
import styles from "./golf.module.css";

export default function CompanyBanner() {
  return (
    <aside className={styles.banner} aria-label="Golf Buddy is brought to you by">
      <p className={styles.bannerLabel}>Golf Buddy is brought to you by</p>
      <div className={styles.bannerRow}>
        {COMPANIES.map((company) => {
          const body = (
            <>
              <strong>{company.name}</strong>
              <span>{company.pitch}</span>
              {company.url && <em>{company.cta} →</em>}
            </>
          );
          return company.url ? (
            <a key={company.name} className={styles.bannerCard} href={company.url} target="_blank" rel="noreferrer">
              {body}
            </a>
          ) : (
            <div key={company.name} className={styles.bannerCard}>
              {body}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
