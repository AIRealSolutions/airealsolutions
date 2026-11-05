import { golfRead, type LeaderRow } from "../lib/api";
import styles from "../golf.module.css";

export const metadata = {
  title: "Season leaderboard",
  description: "Wolf points, wins and rounds played for the Golf Buddy group this season.",
};

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const thisYear = new Date().getFullYear();
  const requested = Number((await searchParams).year);
  const year = Number.isInteger(requested) && requested >= 2020 && requested <= thisYear ? requested : thisYear;
  const rows = await golfRead<LeaderRow[]>("golf_leaderboard", { p_year: year }, []);

  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <p className="eyebrow">Season leaderboard</p>
        <h1>
          {year} <span>Wolf standings</span>
        </h1>
        <p className={styles.lead}>Total Wolf points across every posted round. Players are matched by name.</p>
        <div className={styles.actions}>
          {year > 2026 && (
            <a className="button button-secondary" href={`/golf/leaderboard?year=${year - 1}`}>
              ← {year - 1}
            </a>
          )}
          {year < thisYear && (
            <a className="button button-secondary" href={`/golf/leaderboard?year=${year + 1}`}>
              {year + 1} →
            </a>
          )}
        </div>
      </section>

      <section className={styles.card}>
        {rows.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th className={styles.num}>Points</th>
                  <th className={styles.num}>Wins</th>
                  <th className={styles.num}>Rounds</th>
                  <th className={styles.num}>Avg strokes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.name} className={i === 0 ? styles.winnerRow : undefined}>
                    <td>{i + 1}</td>
                    <td>{r.name}</td>
                    <td className={styles.num}>{r.points}</td>
                    <td className={styles.num}>{r.wins}</td>
                    <td className={styles.num}>{r.rounds}</td>
                    <td className={styles.num}>{r.avgStrokes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.muted}>
            No rounds posted for {year} yet. <a href="/golf/wolf">Start one →</a>
          </p>
        )}
      </section>
    </div>
  );
}
