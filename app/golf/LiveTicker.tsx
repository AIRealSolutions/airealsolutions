// Live feed on the scorecard: the latest plays and grades so far, from the holes finished so far.
import type { Course } from "./lib/api";
import type { Spot } from "./lib/geo";
import { buildRecap, roundDrives, roundFromPayload, type PostedRound } from "./lib/recap";
import styles from "./golf.module.css";

const SHOW = 3;
const GRADES_AFTER = 3; // holes before grades mean anything

export default function LiveTicker({ payload, course }: { payload: PostedRound | string; course: Course }) {
  if (typeof payload === "string" || !payload.holes.length) return null;
  const round = roundFromPayload(payload, course.name);
  const greenOf = (n: number) => (course.holes.find((h) => h.number === n)?.green ?? null) as Spot | null;
  const { feed, grades } = buildRecap(round, roundDrives(round.holes, greenOf), { live: true });
  const latest = feed.slice(-SHOW).reverse();
  const showGrades = round.holes.length >= GRADES_AFTER && grades.length > 1;
  if (!latest.length && !showGrades) return null;
  return (
    <div className={styles.ticker} aria-live="polite">
      <h3>Live feed · thru {round.holes.length}</h3>
      {latest.length > 0 && (
        <ol className={styles.feed}>
          {latest.map((f, k) => (
            <li key={`${feed.length}-${k}`}>
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
      {showGrades && (
        <div className={styles.gradeRow}>
          {grades.map((g) => (
            <span key={g.seat}>
              <span className={`${styles.grade} ${styles[`grade${g.letter}`]}`}>{g.mark}</span> {g.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
