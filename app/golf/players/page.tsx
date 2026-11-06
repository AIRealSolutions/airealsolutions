import { formatDate, getPlayers, getPlayerStats, playerHref } from "../lib/api";
import { getPin } from "../lib/pin";
import { buildSkills, keyOf } from "../lib/skill";
import styles from "../golf.module.css";

export const metadata = {
  title: "Players",
  description: "Everyone in the Golf Buddy group: handicaps, skill levels, records and rounds played.",
};

const TEE_LABEL = { white: "White", blue: "Blue", black: "Black" } as const;

export default async function PlayersPage() {
  const pin = await getPin();
  const [players, stats] = await Promise.all([getPlayers(pin), getPlayerStats(pin)]);
  const skills = buildSkills(stats);
  const sorted = [...players].sort((a, b) => b.rounds - a.rounds || a.name.localeCompare(b.name));

  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <p className="eyebrow">Player database</p>
        <h1>
          The group. <span>Every player, every round.</span>
        </h1>
        <p className={styles.lead}>
          Tap a player for their record, skill level, best partners and round history. Anyone who posts a round shows up
          here; the organizer adds handicaps and contact details in the control panel.
        </p>
      </section>

      <section className={styles.card}>
        {sorted.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Skill</th>
                  <th className={styles.num}>HCP</th>
                  <th className={styles.num}>Dots record</th>
                  <th className={styles.num}>Rounds</th>
                  <th>Last played</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const skill = skills.get(keyOf(p.name));
                  return (
                    <tr key={p.name}>
                      <td>
                        <a className={styles.playerLink} href={playerHref(p.name)}>
                          {p.name}
                        </a>
                        {(p.nickname || p.tees) && (
                          <small className={styles.muted} style={{ display: "block" }}>
                            {[p.nickname && `“${p.nickname}”`, p.tees && `${TEE_LABEL[p.tees]} tees`].filter(Boolean).join(" · ")}
                          </small>
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }} title={skill?.basis}>
                        {skill && !skill.provisional ? (
                          <>
                            <strong>{skill.tier}</strong> {skill.rating}
                          </>
                        ) : (
                          <span className={styles.muted}>new</span>
                        )}
                      </td>
                      <td className={styles.num}>{p.handicap ?? ""}</td>
                      <td className={styles.num}>{p.wins + p.losses + p.ties ? `${p.wins}-${p.losses}-${p.ties}` : ""}</td>
                      <td className={styles.num}>{p.rounds}</td>
                      <td>{p.lastPlayed ? formatDate(p.lastPlayed) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.muted}>
            No players yet. Post a round, or add the group in the <a href="/golf/admin">control panel</a>.
          </p>
        )}
      </section>
    </div>
  );
}
