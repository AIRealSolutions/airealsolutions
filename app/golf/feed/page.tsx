import { formatDate, playerHref } from "../lib/api";
import { TEAM_NAMES } from "../lib/points";
import type { FeedItem } from "../lib/recap";
import { mvpRace, seasonRecaps, type RoundRecap } from "../lib/season";
import styles from "../golf.module.css";

export const metadata = {
  title: "News feed",
  description: "Golf Buddy news: every round's big plays, report card grades and MVP.",
};

const ROUNDS = 15;
const HEADLINE_ICONS = new Set(["🕳️", "🦅", "🐦", "🐺", "💣", "🔥", "⛄"]);
const PER_ROUND = 6;

/** The plays worth a headline: aces, eagles, birdies, Lone Wolf calls, big drives, runs, snowmen. */
function headlines(feed: FeedItem[]) {
  return feed.filter((f) => f.title !== "MVP" && f.title !== "Final" && (f.big || HEADLINE_ICONS.has(f.icon))).slice(0, PER_ROUND);
}

function result({ round }: RoundRecap) {
  if (round.format === "points") {
    const tp = round.teamPoints ?? { black: 0, white: 0 };
    if (tp.black === tp.white) return `Black Belt and White Belt tie ${tp.black}–${tp.white}`;
    const w = tp.black > tp.white ? "black" : "white";
    return `${TEAM_NAMES[w]} wins ${Math.max(tp.black, tp.white)}–${Math.min(tp.black, tp.white)}`;
  }
  const top = Math.max(...round.players.map((p) => p.points));
  return `${round.players.filter((p) => p.points === top).map((p) => p.name).join(" & ")} wins Wolf with ${top}`;
}

export default async function FeedPage() {
  const year = new Date().getFullYear();
  const [items, season] = await Promise.all([seasonRecaps(null, ROUNDS), seasonRecaps(year, 500)]);
  const race = mvpRace(season).filter((r) => r.mvps > 0).slice(0, 3);

  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <p className="eyebrow">News feed</p>
        <h1>
          The clubhouse <span>wire.</span>
        </h1>
        <p className={styles.lead}>Every posted round: the big plays, the report card and the MVP. Newest first.</p>
      </section>

      {race.length > 0 && (
        <section className={styles.card}>
          <h2>{year} MVP race</h2>
          <div className={styles.awards}>
            {race.map((r, i) => (
              <div key={r.name} className={styles.award}>
                <span aria-hidden>{["🥇", "🥈", "🥉"][i]}</span>
                <div>
                  <small>{r.mvps === 1 ? "1 MVP" : `${r.mvps} MVPs`}</small>
                  <strong>
                    <a className={styles.playerLink} href={playerHref(r.name)}>
                      {r.name}
                    </a>
                  </strong>
                  <small className={styles.muted}>
                    Avg {r.avgScore}/100 · {r.rounds} {r.rounds === 1 ? "round" : "rounds"}
                  </small>
                </div>
              </div>
            ))}
          </div>
          <p className={styles.muted} style={{ margin: "12px 0 0" }}>
            <a href="/golf/leaderboard#mvp">Full MVP race →</a>
          </p>
        </section>
      )}

      {items.length ? (
        items.map((item) => {
          const { round, recap } = item;
          const plays = headlines(recap.feed);
          return (
            <article key={round.id} className={styles.card}>
              <p className="eyebrow" style={{ marginBottom: 4 }}>
                {round.format === "points" ? (round.settings?.rules?.scramble ? "Dots · Captain's choice" : "Dots") : "Wolf"} ·{" "}
                {round.course.name} · {formatDate(round.playedOn)}
              </p>
              <h2>
                <a href={`/golf/rounds/${round.id}`}>{result(item)}</a>
              </h2>
              {recap.mvp && (
                <p style={{ margin: "0 0 10px" }}>
                  🏆 <strong>MVP: {recap.mvp.name}</strong>{" "}
                  <span className={`${styles.grade} ${styles[`grade${recap.mvp.letter}`]}`} style={{ height: 26, minWidth: 34, fontSize: "0.85rem" }}>
                    {recap.mvp.mark}
                  </span>{" "}
                  <span className={styles.muted}>{recap.mvp.why}</span>
                </p>
              )}
              <div className={styles.gradeRow}>
                {recap.grades.map((g) => (
                  <span key={g.seat}>
                    <span className={`${styles.grade} ${styles[`grade${g.letter}`]}`}>{g.mark}</span> {g.name}
                  </span>
                ))}
              </div>
              {plays.length > 0 && (
                <ol className={styles.feed} style={{ marginTop: 8 }}>
                  {plays.map((f, i) => (
                    <li key={i}>
                      <span className={styles.feedIcon} aria-hidden>
                        {f.icon}
                      </span>
                      <div>
                        <strong>{f.title}</strong>
                        <p>{f.text}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              <p style={{ margin: "10px 0 0" }}>
                <a href={`/golf/rounds/${round.id}`}>Full recap and play by play →</a>
              </p>
            </article>
          );
        })
      ) : (
        <section className={styles.card}>
          <p className={styles.muted}>
            No rounds posted yet. <a href="/golf#games">Start one →</a>
          </p>
        </section>
      )}
    </div>
  );
}
