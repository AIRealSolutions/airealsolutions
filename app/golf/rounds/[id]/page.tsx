import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatDate, golfRead, type SavedRound } from "../../lib/api";
import ShareButton from "./ShareButton";
import styles from "../../golf.module.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getRound(id: string) {
  if (!UUID.test(id)) return null;
  const round = await golfRead<SavedRound | null>("golf_round", { p_id: id }, null, 60);
  return round?.players?.length && round.holes?.length ? round : null;
}

const standings = (round: SavedRound) =>
  [...round.players].sort((a, b) => b.points - a.points || a.strokes - b.strokes);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const round = await getRound((await params).id);
  if (!round) return { title: "Round not found" };
  const [leader] = standings(round);
  const title = `${leader.name} wins Wolf at ${round.course.name}`;
  const description = `${formatDate(round.playedOn)} · ${round.players.map((p) => `${p.name} ${p.points}`).join(", ")}. Scored with Golf Buddy by AI Real Solutions.`;
  return { title, description, openGraph: { title, description, siteName: "Golf Buddy by AI Real Solutions" } };
}

export default async function RoundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const round = await getRound(id);
  if (!round) notFound();

  const ranked = standings(round);
  const top = ranked[0].points;
  const name = (seat: number | null) => (seat === null ? "" : (round.players.find((p) => p.seat === seat)?.name ?? ""));

  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <p className="eyebrow">
          Wolf · {round.course.name} · {formatDate(round.playedOn)}
        </p>
        <h1>
          {ranked.filter((p) => p.points === top).map((p) => p.name).join(" & ")} <span>wins.</span>
        </h1>
        <div className={styles.actions}>
          <ShareButton />
          <a className="button button-secondary" href="/golf/wolf">
            Start a new round
          </a>
        </div>
      </section>

      <section className={styles.card}>
        <h2>Final standings</h2>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th className={styles.num}>Points</th>
                <th className={styles.num}>Strokes</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((p, i) => (
                <tr key={p.seat} className={p.points === top ? styles.winnerRow : undefined}>
                  <td>{i + 1}</td>
                  <td>{p.name}</td>
                  <td className={styles.num}>{p.points}</td>
                  <td className={styles.num}>{p.strokes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {round.submittedBy && <p className={styles.muted}>Scorekeeper: {round.submittedBy}</p>}
      </section>

      <section className={styles.card}>
        <h2>Hole by hole</h2>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Hole</th>
                <th>Wolf</th>
                {round.players.map((p) => (
                  <th key={p.seat} className={styles.num}>
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {round.holes.map((h) => (
                <tr key={h.number}>
                  <td>
                    <strong>{h.number}</strong>
                    <br />
                    <small className={styles.muted}>Par {h.par}</small>
                  </td>
                  <td>
                    🐺 {name(h.wolfSeat)}
                    <br />
                    <small className={styles.muted}>{h.loneWolf ? "Lone Wolf" : `w/ ${name(h.partnerSeat)}`}</small>
                    {h.comment && <div className={styles.comment}>“{h.comment}”</div>}
                  </td>
                  {round.players.map((p) => (
                    <td key={p.seat} className={styles.num}>
                      {h.strokes[p.seat]}
                      {h.points[p.seat] > 0 && <span className={styles.pts}>+{h.points[p.seat]}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
