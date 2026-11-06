import type { Metadata } from "next";
import CompanyBanner from "./CompanyBanner";
import PinGate from "./PinGate";
import { getSettings } from "./lib/api";
import { checkPin, getPin, getPinError } from "./lib/pin";
import styles from "./golf.module.css";

export const metadata: Metadata = {
  title: { default: "Golf Buddy", template: "%s | Golf Buddy" },
  description: "Keep a Wolf scorecard on your phone, add comments on every hole, and share the round with your group.",
};

export default async function GolfLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Whole site behind the group PIN (the admin PIN works too) once a group PIN is set.
  const settings = await getSettings();
  let unlocked = true;
  let gateError = "";
  if (settings.pinRequired) {
    const pin = await getPin();
    const result = await checkPin(pin);
    unlocked = Boolean(result.role);
    gateError = (await getPinError()) || (pin ? result.error ?? "" : "");
  }
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
          <a href="/golf/players">Players</a>
          <a href="/golf/stats">Stats</a>
          <a href="/golf/me">Me</a>
          <a className="nav-cta" href="/golf#games" aria-label="Start a round">
            <span className={styles.longLabel}>Start a round</span>
            <span className={styles.shortLabel}>Play</span>
          </a>
        </nav>
      </header>
      <CompanyBanner />
      {unlocked ? children : <PinGate error={gateError} />}
    </main>
  );
}
