import { formatDate, getSettings, golfRead, type RecentRound } from "./lib/api";
import styles from "./golf.module.css";

export const metadata = {
  title: { absolute: "Golf Buddy | AI Real Solutions" },
  description: "Free scorecards for our golf group: Wolf and Black Belt vs White Belt Team Points. Comment on every hole and share the round.",
};

export default async function GolfHome() {
  const [recent, settings] = await Promise.all([
    golfRead<RecentRound[]>("golf_recent_rounds", { p_limit: 8 }, []),
    getSettings(),
  ]);
  const w = settings.games.wolf.rules;
  const t = settings.games.points.rules;
  const bet = settings.betPerPoint;

  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <p className="eyebrow">Golf Buddy</p>
        <h1>
          Keep score on your phone. <span>Settle it on the leaderboard.</span>
        </h1>
        <p className={styles.lead}>
          Anyone in the group can keep the card. Enter scores hole by hole, leave a comment on the shot everyone
          will be talking about, then share the round with the group.
        </p>
      </section>

      <div className={styles.gameCards} id="games">
        {settings.games.points.enabled && (
        <section className={`${styles.card} ${styles.gameCard}`} style={{ order: settings.defaultGame === "points" ? 0 : 1 }}>
          <p className="eyebrow">Team game · 2 to 8 players</p>
          <h2>Team Points: Black Belt vs White Belt</h2>
          <ul className={styles.rules}>
            <li>Pick teams each round. Every player's record is kept.</li>
            <li>Best ball on each hole: {t.bestBall} point to the team.</li>
            <li>Birdie +{t.birdie}. Eagle or better +{t.birdie + t.eagleBonus}.</li>
            <li>Sand save +{t.sandSave}. Closest to the hole +{t.closest}.</li>
            <li>Most team points wins the round.</li>
            {bet > 0 && <li>Losing team pays ${bet} per point of difference, each.</li>}
          </ul>
          <div className={styles.actions}>
            <a className={`button ${styles.greenButton}`} href="/golf/points">
              Start Team Points
            </a>
          </div>
        </section>
        )}

        {settings.games.wolf.enabled && (
        <section className={`${styles.card} ${styles.gameCard}`} style={{ order: settings.defaultGame === "wolf" ? 0 : 1 }}>
          <p className="eyebrow">Rotating game · 3 to 5 players</p>
          <h2>Wolf</h2>
          <ul className={styles.rules}>
            <li>The Wolf rotates every hole and picks a partner or goes Lone Wolf.</li>
            <li>Wolf and partner win: {w.teamWin} each. The other side wins: {w.opponentsWin} each.</li>
            <li>
              Lone Wolf wins: {w.loneWin}. Lone Wolf loses: {w.loneLoss} to each opponent.
            </li>
            <li>Ties carry no points. Most points wins.</li>
            {bet > 0 && <li>Everyone settles up at ${bet} per point with every other player.</li>}
          </ul>
          <div className={styles.actions}>
            <a className="button button-secondary" href="/golf/wolf">
              Start Wolf
            </a>
          </div>
        </section>
        )}
      </div>

      <section className={styles.card}>
        <h2>Recent rounds</h2>
        {recent.length ? (
          <ul className={styles.list}>
            {recent.map((round) => (
              <li key={round.id}>
                <a href={`/golf/rounds/${round.id}`}>
                  <strong>{round.winner ? `${round.winner} won` : "Tied round"}</strong>{" "}
                  {round.format === "points" ? "Team Points" : "Wolf"} at {round.course}
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
        <p style={{ marginBottom: 0 }}>
          <a className="text-link" href="/golf/leaderboard">
            Season leaderboard →
          </a>
        </p>
      </section>
    </div>
  );
}
