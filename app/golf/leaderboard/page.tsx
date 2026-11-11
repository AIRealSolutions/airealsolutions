import { golfRead, playerHref, type LeaderRow, type TeamRecord } from "../lib/api";
import { getPin } from "../lib/pin";
import { mvpRace, seasonRecaps } from "../lib/season";
import styles from "../golf.module.css";

export const metadata = {
  title: "Season leaderboard",
  description: "Black Belt vs White Belt records and Wolf standings for the Golf Buddy group this season.",
};

type Game = "points" | "wolf";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; game?: string }>;
}) {
  const params = await searchParams;
  const thisYear = new Date().getFullYear();
  const requested = Number(params.year);
  const year = Number.isInteger(requested) && requested >= 2020 && requested <= thisYear ? requested : thisYear;
  const game: Game = params.game === "wolf" ? "wolf" : "points";
  const pin = await getPin();
  const [rows, teams, season] = await Promise.all([
    golfRead<LeaderRow[]>("golf_leaderboard", { p_year: year, p_format: game, p_pin: pin }, []),
    game === "points" ? golfRead<TeamRecord | null>("golf_team_record", { p_year: year, p_pin: pin }, null) : Promise.resolve(null),
    seasonRecaps(year, 500),
  ]);
  const race = mvpRace(season.filter((s) => s.round.format === game));
  const href = (g: Game, y = year) => `/golf/leaderboard?game=${g}&year=${y}`;

  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <p className="eyebrow">Season leaderboard</p>
        <h1>
          {year} <span>{game === "points" ? "Dots records" : "Wolf standings"}</span>
        </h1>
        <p className={styles.lead}>
          {game === "points"
            ? "Teams change every round, so each player's record follows them. Dots are a team score: best ball, birdies, eagles, sand saves and closest to the hole all count for the team."
            : "Total Wolf points across every posted round."}{" "}
          Players are matched by name.
        </p>
        <div className={styles.tabs}>
          <a className={`button ${game === "points" ? styles.greenButton : "button-secondary"}`} href={href("points")}>
            Dots
          </a>
          <a className={`button ${game === "wolf" ? styles.greenButton : "button-secondary"}`} href={href("wolf")}>
            Wolf
          </a>
          {year > 2026 && (
            <a className="button button-secondary" href={href(game, year - 1)}>
              ← {year - 1}
            </a>
          )}
          {year < thisYear && (
            <a className="button button-secondary" href={href(game, year + 1)}>
              {year + 1} →
            </a>
          )}
        </div>
      </section>

      {game === "points" && teams && teams.rounds > 0 && (
        <section className={styles.card}>
          <h2>Black Belt vs White Belt</h2>
          <div className={styles.teamScore}>
            <div className={styles.teamBlack}>
              <small>Black Belt wins</small>
              <strong>{teams.blackWins}</strong>
            </div>
            <div className={styles.teamWhite}>
              <small>White Belt wins</small>
              <strong>{teams.whiteWins}</strong>
            </div>
          </div>
          <p className={styles.muted} style={{ marginBottom: 0 }}>
            {teams.rounds} {teams.rounds === 1 ? "round" : "rounds"} · {teams.ties} tied · Season points: Black Belt {teams.blackPoints}, White Belt {teams.whitePoints}
          </p>
        </section>
      )}

      <section className={styles.card}>
        {rows.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                {game === "points" ? (
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th className={styles.num}>Record</th>
                    <th className={styles.num}>Rounds</th>
                    <th className={styles.num}>Avg strokes</th>
                  </tr>
                ) : (
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th className={styles.num}>Points</th>
                    <th className={styles.num}>Wins</th>
                    <th className={styles.num}>Rounds</th>
                    <th className={styles.num}>Avg strokes</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.name} className={i === 0 ? styles.winnerRow : undefined}>
                    <td>{i + 1}</td>
                    <td>
                      <a className={styles.playerLink} href={playerHref(r.name)}>
                        {r.name}
                      </a>
                    </td>
                    {game === "points" ? (
                      <>
                        <td className={styles.num}>
                          {r.wins}-{r.losses}-{r.ties}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className={styles.num}>{r.points}</td>
                        <td className={styles.num}>{r.wins}</td>
                      </>
                    )}
                    <td className={styles.num}>{r.rounds}</td>
                    <td className={styles.num}>{r.avgStrokes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.muted}>
            No {game === "points" ? "Dots" : "Wolf"} rounds posted for {year} yet.{" "}
            <a href={game === "points" ? "/golf/points" : "/golf/wolf"}>Start one →</a>
          </p>
        )}
      </section>

      {race.length > 0 && (
        <section className={styles.card} id="mvp">
          <h2>MVP race</h2>
          <p className={styles.muted}>
            Every {game === "points" ? "Dots" : "Wolf"} round grades each player A–D against the field and names an MVP. Avg is the
            round score out of 100.
          </p>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th className={styles.num}>MVPs</th>
                  <th className={styles.num}>Avg</th>
                  <th className={styles.num}>A · B · C · D</th>
                  <th className={styles.num}>Best</th>
                </tr>
              </thead>
              <tbody>
                {race.map((r, i) => (
                  <tr key={r.name} className={i === 0 && r.mvps > 0 ? styles.winnerRow : undefined}>
                    <td>{i + 1}</td>
                    <td>
                      <a className={styles.playerLink} href={playerHref(r.name)}>
                        {r.name}
                      </a>
                    </td>
                    <td className={styles.num}>{r.mvps ? `🏆 ${r.mvps}` : 0}</td>
                    <td className={styles.num}>{r.avgScore}</td>
                    <td className={styles.num}>
                      {r.letters.A} · {r.letters.B} · {r.letters.C} · {r.letters.D}
                    </td>
                    <td className={styles.num}>{r.best}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
