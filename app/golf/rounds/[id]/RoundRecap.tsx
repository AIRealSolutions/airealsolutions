// Round recap: MVP banner, A–D grades for the round, side awards and the play-by-play feed.
import type { FeedItem, Recap } from "../../lib/recap";
import styles from "../../golf.module.css";

const FEED_PREVIEW = 20; // longer feeds show the headline plays first, with every play one tap away
const HEADLINES = new Set(["🕳️", "🦅", "🐦", "🐺", "💣", "📈", "🔥", "📊", "🏁", "🏆"]);

function FeedList({ items }: { items: FeedItem[] }) {
  return (
    <ol className={styles.feed}>
      {items.map((f, i) => (
        <li key={i} className={f.big ? styles.feedBig : undefined}>
          <span className={styles.feedIcon} aria-hidden>
            {f.icon}
          </span>
          <div>
            <strong>{f.title}</strong>
            {f.hole !== null && <small className={styles.muted}> · Hole {f.hole}</small>}
            <p>{f.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function RoundRecap({ recap }: { recap: Recap }) {
  const { feed, grades, mvp, awards, note } = recap;
  if (!grades.length) return null;
  const preview = feed.length > FEED_PREVIEW;
  const highlights = preview ? feed.filter((f) => f.big || HEADLINES.has(f.icon)) : [];
  return (
    <>
      {mvp && (
        <section className={styles.mvp}>
          <span className={styles.mvpTrophy} aria-hidden>
            🏆
          </span>
          <div>
            <p className={styles.mvpLabel}>Round MVP</p>
            <h2>
              {mvp.name} <span className={`${styles.grade} ${styles[`grade${mvp.letter}`]}`}>{mvp.mark}</span>
            </h2>
            <p>{mvp.why}</p>
          </div>
        </section>
      )}

      <section className={styles.card}>
        <h2>Report card</h2>
        <p className={styles.muted}>Graded against everyone in this round: level with the best on each part of the game earns full marks.</p>
        {note && <p className={styles.muted}>{note}</p>}
        <ul className={styles.gradeList}>
          {grades.map((g) => (
            <li key={g.seat}>
              <span className={`${styles.grade} ${styles[`grade${g.letter}`]}`}>{g.mark}</span>
              <div>
                <strong>{g.name}</strong> <small className={styles.muted}>· {g.score}/100</small>
                <p className={styles.muted}>{g.line}</p>
              </div>
            </li>
          ))}
        </ul>
        {awards.length > 0 && (
          <>
            <h3 className={styles.subhead}>Awards</h3>
            <div className={styles.awards}>
              {awards.map((a) => (
                <div key={a.title} className={styles.award}>
                  <span aria-hidden>{a.icon}</span>
                  <div>
                    <small>{a.title}</small>
                    <strong>{a.who}</strong>
                    <small className={styles.muted}>{a.detail}</small>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {feed.length > 0 && (
        <section className={styles.card}>
          <h2>Play by play</h2>
          {preview ? (
            <>
              <FeedList items={highlights.length ? highlights.slice(-FEED_PREVIEW) : feed.slice(-FEED_PREVIEW)} />
              <details className={styles.feedMore}>
                <summary>Every play ({feed.length})</summary>
                <FeedList items={feed} />
              </details>
            </>
          ) : (
            <FeedList items={feed} />
          )}
        </section>
      )}
    </>
  );
}
