import { getPlayerStats, playerHref } from "../lib/api";
import { getPin } from "../lib/pin";
import { buildSkills, keyOf, shareIndex, TIER_LABEL, type PlayerStat } from "../lib/skill";
import styles from "../golf.module.css";

export const metadata = {
  title: "Player stats",
  description: "Whose shots the team uses in captain's choice, best balls, scoring and skill levels for fair teams.",
};

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);

function leader(rows: PlayerStat[], value: (r: PlayerStat) => number, min = 1) {
  const top = Math.max(0, ...rows.map(value));
  if (top < min) return null;
  return { names: rows.filter((r) => value(r) === top).map((r) => r.name).join(" & "), top };
}

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const params = await searchParams;
  const thisYear = new Date().getFullYear();
  const requested = Number(params.year);
  const year = Number.isInteger(requested) && requested >= 2020 && requested <= thisYear ? requested : thisYear;
  const pin = await getPin();
  // Season numbers for the table; skill always uses every season.
  const [season, allTime] = await Promise.all([getPlayerStats(pin, year), getPlayerStats(pin)]);
  const skills = buildSkills(allTime);
  const rows = [...season].sort(
    (a, b) => b.shotsUsed - a.shotsUsed || b.bestBalls - a.bestBalls || a.name.localeCompare(b.name),
  );
  const share = (r: PlayerStat) => shareIndex(r) ?? 0;
  const leaders = [
    { label: "Most shots used", hit: leader(rows, (r) => r.shotsUsed), unit: "shots" },
    { label: "Best share of team shots", hit: leader(rows, (r) => Math.round(share(r) * 100), 1), unit: "% of fair share" },
    { label: "Most tee shots used", hit: leader(rows, (r) => r.teeShots), unit: "drives" },
    { label: "Most holed out", hit: leader(rows, (r) => r.holedShots), unit: "holed" },
    { label: "Most best balls", hit: leader(rows, (r) => r.bestBalls), unit: "holes" },
    { label: "Longest drive", hit: leader(rows, (r) => r.longestDrive ?? 0), unit: "yds (GPS)" },
    { label: "Best average drive", hit: leader(rows.filter((r) => (r.drives ?? 0) >= 3), (r) => r.avgDrive ?? 0), unit: "yds avg (3+ drives)" },
  ].filter((l) => l.hit);
  const href = (y: number) => `/golf/stats?year=${y}`;

  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <p className="eyebrow">Player stats</p>
        <h1>
          {year} <span>Whose shot did we use?</span>
        </h1>
        <p className={styles.lead}>
          In captain&apos;s choice, the scorekeeper taps whose ball the team played on every shot. Those picks, plus scores
          from regular rounds and handicaps from the control panel, set each player&apos;s skill level, which the scorecard
          uses to balance teams.
        </p>
        <div className={styles.tabs}>
          {year > 2026 && (
            <a className="button button-secondary" href={href(year - 1)}>
              ← {year - 1}
            </a>
          )}
          {year < thisYear && (
            <a className="button button-secondary" href={href(year + 1)}>
              {year + 1} →
            </a>
          )}
          <a className={`button ${styles.greenButton}`} href="/golf/points">
            Start Dots
          </a>
        </div>
      </section>

      {leaders.length > 0 && (
        <section className={styles.card}>
          <h2>Leaders</h2>
          <div className={styles.statLeaders}>
            {leaders.map((l) => (
              <div key={l.label}>
                <small>{l.label}</small>
                <strong>{l.hit!.names}</strong>
                <small>
                  {l.hit!.top} {l.unit}
                </small>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className={styles.card}>
        <h2>Every player</h2>
        {rows.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Skill</th>
                  <th className={styles.num}>Shots used</th>
                  <th className={styles.num}>Share</th>
                  <th className={styles.num}>Tee</th>
                  <th className={styles.num}>Holed</th>
                  <th className={styles.num}>Best balls</th>
                  <th className={styles.num}>Avg drive</th>
                  <th className={styles.num}>Long</th>
                  <th className={styles.num}>Avg vs par</th>
                  <th className={styles.num}>Rounds</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const skill = skills.get(keyOf(r.name));
                  const idx = shareIndex(r);
                  return (
                    <tr key={r.name} className={i === 0 && r.shotsUsed > 0 ? styles.winnerRow : undefined}>
                      <td>
                        <a className={styles.playerLink} href={playerHref(r.name)}>
                          {r.name}
                        </a>
                      </td>
                      <td title={skill?.basis} style={{ whiteSpace: "nowrap" }}>
                        {skill && !skill.provisional ? (
                          <>
                            <strong>{skill.tier}</strong> {skill.rating}
                          </>
                        ) : (
                          <span className={styles.muted}>new</span>
                        )}
                      </td>
                      <td className={styles.num}>
                        {r.shotsUsed}
                        {r.teamShots > 0 && <small className={styles.muted}> / {r.teamShots}</small>}
                      </td>
                      <td className={styles.num}>{pct(idx)}</td>
                      <td className={styles.num}>{r.teeShots}</td>
                      <td className={styles.num}>{r.holedShots}</td>
                      <td className={styles.num}>{r.bestBalls}</td>
                      <td className={styles.num}>{r.avgDrive ? `${r.avgDrive}` : "–"}</td>
                      <td className={styles.num}>{r.longestDrive ? `${r.longestDrive}` : "–"}</td>
                      <td className={styles.num}>
                        {r.holes ? `${r.overPar >= 0 ? "+" : ""}${(r.overPar / r.holes).toFixed(2)}` : "–"}
                      </td>
                      <td className={styles.num}>{r.rounds}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.muted}>No rounds posted for {year} yet.</p>
        )}
        <p className={styles.muted} style={{ marginBottom: 0 }}>
          <strong>Share</strong> compares shots used with a fair share (one in two on a two-player team): 100% is even,
          over 100% means the team leaned on that player. <strong>Skill</strong> reads like a handicap, lower is better:{" "}
          {Object.values(TIER_LABEL).join(", ")}. Players are matched by name.
        </p>
      </section>
    </div>
  );
}
