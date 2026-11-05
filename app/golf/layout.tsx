import type { Metadata } from "next";
import CompanyBanner from "./CompanyBanner";
import styles from "./golf.module.css";

export const metadata: Metadata = {
  title: { default: "Golf Buddy", template: "%s | Golf Buddy" },
  description: "Keep a Wolf scorecard on your phone, add comments on every hole, and share the round with your group.",
};

export default function GolfLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className={styles.golf}>
      <header className="site-header">
        <a className="brand" href="/" aria-label="AI Real Solutions home">
          <span className="brand-mark">AI</span>
          <span>Real Solutions</span>
        </a>
        <nav aria-label="Golf Buddy navigation" className={styles.nav}>
          <a href="/golf">Golf Buddy</a>
          <a href="/golf/leaderboard">Leaderboard</a>
          <a className="nav-cta" href="/golf#games">
            Start a round
          </a>
        </nav>
      </header>
      <CompanyBanner />
      {children}
    </main>
  );
}
