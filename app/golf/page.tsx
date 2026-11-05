import { formatDate, golfRead, type RecentRound } from "./lib/api";
import { DEFAULT_RULES } from "./lib/wolf";
import styles from "./golf.module.css";

export const metadata = {
  title: { absolute: "Golf Buddy | AI Real Solutions" },
  description: "A free Wolf scorecard for our golf group: score on your phone, comment on every hole, and share the round.",
};

export default async function GolfHome() {
  const recent = await golfRead<RecentRound[]>("golf_recent_rounds", { p_limit: 8 }, []);
  const r = DEFAULT_RULES;

  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <p className="eyebrow">Golf Buddy</p>
        <h1>
          Play Wolf. <span>Keep score on your phone.</span>
        </h1>
        <p className={styles.lead}>
          Anyone in the group can keep the card. Enter scores hole by hole, pick partners, leave a comment on the
          shot everyone will be talking about, then share the round with the group.
        </p>
        <div className={styles.actions}>
          <a className={`button ${styles.greenButton}`} href="/golf/wolf">
            Start a Wolf round
          </a>
          <a className="button button-secondary" href="/golf/leaderboard">
            Season leaderboard
          </a>
        </div>
      </section>

      <div className={styles.grid2}>
        <section className={styles.card}>
          <h2>Recent rounds</h2>
          {recent.length ? (
            <ul className={styles.list}>
              {recent.map((round) => (
                <li key={round.id}>
                  <a href={`/golf/rounds/${round.id}`}>
                    <strong>{round.winner ? `${round.winner} won` : "Round"}</strong> at {round.course}
                    <small>
                      {formatDate(round.playedOn)} · {round.players}
                    </small>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>No rounds yet. Be the first to post one.</p>
          )}
        </section>

        <section className={styles.card}>
          <h2>How Wolf works</h2>
          <ul className={styles.rules}>
            <li>3 to 5 players. The Wolf rotates every hole in tee order.</li>
            <li>After the tee shots, the Wolf picks a partner or goes Lone Wolf.</li>
            <li>Each side plays its best ball. Lowest score wins the hole.</li>
            <li>
              Wolf and partner win: {r.teamWin} points each. The other side wins: {r.opponentsWin} points each.
            </li>
            <li>
              Lone Wolf wins: {r.loneWin} points. Lone Wolf loses: {r.loneLoss} point to each opponent.
            </li>
            <li>Ties carry no points. Most points after the round wins.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
