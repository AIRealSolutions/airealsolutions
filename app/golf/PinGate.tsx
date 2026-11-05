import styles from "./golf.module.css";

/** Shown instead of any golf page until the group PIN is entered on this device. */
export default function PinGate({ error }: { error?: string }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.scorecard}>
        <section className={styles.card}>
          <p className="eyebrow">Golf Buddy</p>
          <h2>Enter the group PIN</h2>
          <p className={styles.muted}>Ask the group organizer for the PIN. This phone will remember it.</p>
          {error && <p className={styles.error}>{error}</p>}
          <form method="post" action="/golf/unlock">
            <label className={styles.field}>
              <span>Group PIN</span>
              <input
                className={styles.input}
                name="pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                maxLength={8}
                required
                autoFocus
              />
            </label>
            <button type="submit" className={`button ${styles.greenButton}`}>
              Open Golf Buddy
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
