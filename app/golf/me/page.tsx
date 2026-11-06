import { getRoster, playerHref } from "../lib/api";
import { getMe, getMeMessage } from "../lib/me";
import { getPin } from "../lib/pin";
import { RosterList } from "../PostRound";
import styles from "../golf.module.css";

export const metadata = {
  title: "My profile",
  description: "Sign in to Golf Buddy to edit your name, nickname, tees and contact details.",
};

export default async function MePage() {
  const [me, message] = await Promise.all([getMe(), getMeMessage()]);
  const notice = message && (
    <p className={message.error ? styles.error : styles.notice} role="status">
      {message.text}
    </p>
  );

  if (!me) {
    const roster = await getRoster(await getPin());
    return (
      <div className={styles.wrap}>
        <div className={styles.scorecard}>
          <section className={styles.card}>
            <p className="eyebrow">My profile</p>
            <h2>Sign in</h2>
            <p className={styles.muted}>
              First time? Ask the organizer for your 6-digit sign-in code. You&apos;ll choose your own PIN after you sign in.
            </p>
            {notice}
            <form method="post" action="/golf/me/login">
              <label className={styles.field}>
                <span>Your name (as it shows on the scorecard)</span>
                <input className={styles.input} name="name" maxLength={40} autoComplete="username" list="golf-roster" required />
              </label>
              <RosterList names={roster} />
              <label className={styles.field}>
                <span>PIN or sign-in code</span>
                <input
                  className={styles.input}
                  name="secret"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  autoComplete="current-password"
                  required
                />
              </label>
              <button type="submit" className={`button ${styles.greenButton}`}>
                Sign in
              </button>
            </form>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.scorecard}>
        <section className={styles.card}>
          <p className="eyebrow">My profile</p>
          <h2>{me.name}</h2>
          {notice}
          {!me.hasPin && <p className={styles.waiting}>Choose your own PIN (4 to 8 digits) so you can sign in next time.</p>}
          <form method="post" action="/golf/me/save">
            <label className={styles.field}>
              <span>Name</span>
              <input className={styles.input} name="name" defaultValue={me.name} maxLength={40} required />
              <small className={styles.muted}>Changing it moves your posted rounds to the new name.</small>
            </label>
            <label className={styles.field}>
              <span>Nickname (optional)</span>
              <input className={styles.input} name="nickname" defaultValue={me.nickname ?? ""} maxLength={40} />
            </label>
            <label className={styles.field}>
              <span>Usual tees</span>
              <select className={styles.select} name="tees" defaultValue={me.tees ?? ""}>
                <option value="">Not set</option>
                <option value="white">White</option>
                <option value="blue">Blue</option>
                <option value="black">Black</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>Email (only the organizer sees it)</span>
              <input className={styles.input} name="email" type="email" defaultValue={me.email ?? ""} maxLength={120} autoComplete="email" />
            </label>
            <label className={styles.field}>
              <span>Phone (only the organizer sees it)</span>
              <input className={styles.input} name="phone" type="tel" defaultValue={me.phone ?? ""} maxLength={30} autoComplete="tel" />
            </label>
            <p className={styles.muted}>
              Handicap: <strong>{me.handicap ?? "not set"}</strong>. The organizer keeps handicaps up to date because they set fair teams.
            </p>
            <fieldset className={styles.betBox}>
              <legend>{me.hasPin ? "Change your PIN (optional)" : "Choose your PIN"}</legend>
              <div className={styles.grid2} style={{ gap: 12 }}>
                <label className={styles.field} style={{ marginBottom: 0 }}>
                  <span>New PIN</span>
                  <input
                    className={styles.input}
                    name="newPin"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{4,8}"
                    minLength={4}
                    maxLength={8}
                    autoComplete="new-password"
                    required={!me.hasPin}
                  />
                </label>
                <label className={styles.field} style={{ marginBottom: 0 }}>
                  <span>Type it again</span>
                  <input
                    className={styles.input}
                    name="confirmPin"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{4,8}"
                    minLength={4}
                    maxLength={8}
                    autoComplete="new-password"
                    required={!me.hasPin}
                  />
                </label>
              </div>
            </fieldset>
            <div className={styles.actions}>
              <button type="submit" className={`button ${styles.greenButton}`}>
                Save
              </button>
              <a className="button button-secondary" href={playerHref(me.name)}>
                View my stats
              </a>
            </div>
          </form>
          <form method="post" action="/golf/me/logout" style={{ marginTop: 16 }}>
            <button type="submit" className={styles.textButton}>
              Sign out on this device
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
