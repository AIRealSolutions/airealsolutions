import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatDate, golfRead, type SavedRound } from "../../lib/api";
import { TEAM_NAMES, nassauOf, scoreLabel, type Team } from "../../lib/points";
import { money, settleDots, settleWolf } from "../../lib/settle";
import ShareButton from "./ShareButton";
import styles from "../../golf.module.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getRound(id: string) {
  if (!UUID.test(id)) return null;
  const round = await golfRead<SavedRound | null>("golf_round", { p_id: id }, null, 60);
  return round?.players?.length && round.holes?.length ? round : null;
}

const standings = (round: SavedRound) => [...round.players].sort((a, b) => b.points - a.points || a.strokes - b.strokes);

function winnerText(round: SavedRound) {
  if (round.format === "points") {
    const tp = round.teamPoints ?? { black: 0, white: 0 };
    if (tp.black === tp.white) return { who: "Black Belt & White Belt", verb: "tie." };
    return { who: TEAM_NAMES[tp.black > tp.white ? "black" : "white"], verb: "wins." };
  }
  const ranked = standings(round);
  const top = ranked[0].points;
  return { who: ranked.filter((p) => p.points === top).map((p) => p.name).join(" & "), verb: "wins." };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const round = await getRound((await params).id);
  if (!round) return { title: "Round not found" };
  const game = round.format === "points" ? "Dots" : "Wolf";
  const { who, verb } = winnerText(round);
  const title = `${who} ${verb === "tie." ? "tie" : "wins"} ${game} at ${round.course.name}`;
  const score =
    round.format === "points" && round.teamPoints
      ? `Black Belt ${round.teamPoints.black} dots, White Belt ${round.teamPoints.white} dots`
      : round.players.map((p) => `${p.name} ${p.points}`).join(", ");
  const description = `${formatDate(round.playedOn)} · ${score}. Scored with Golf Buddy by AI Real Solutions.`;
  return { title, description, openGraph: { title, description, siteName: "Golf Buddy by AI Real Solutions" } };
}

function TeamTag({ team }: { team: Team | null }) {
  if (!team) return null;
  return <span className={`${styles.teamTag} ${team === "black" ? styles.teamBlack : styles.teamWhite}`}>{TEAM_NAMES[team]}</span>;
}

export default async function RoundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const round = await getRound(id);
  if (!round) notFound();

  const isPoints = round.format === "points";
  const ranked = standings(round);
  const { who, verb } = winnerText(round);
  const name = (seat: number | null | undefined) =>
    seat === null || seat === undefined ? "" : (round.players.find((p) => p.seat === seat)?.name ?? "");
  const resultLabel = { win: "W", loss: "L", tie: "T" } as const;
  const bet = Number(round.settings?.rules?.betPerPoint ?? round.settings?.betPerPoint ?? 0);
  const nassau = nassauOf(round.settings?.rules);
  const bySeat = [...round.players].sort((a, b) => a.seat - b.seat);
  const dots = isPoints
    ? settleDots(
        bySeat.map((p) => p.team ?? "black"),
        round.holes.map((h) => ({ number: h.number, teamPoints: h.extras?.teamPoints ?? { black: 0, white: 0 } })),
        nassau,
        bet,
      )
    : null;
  const hasMoney = isPoints ? bet > 0 || nassau.front > 0 || nassau.back > 0 || nassau.total > 0 : bet > 0;
  const payoutBySeat = new Map<number, number>();
  if (hasMoney) {
    const amounts = dots ? dots.perPlayer : settleWolf(bySeat.map((p) => p.points), bet);
    bySeat.forEach((p, i) => payoutBySeat.set(p.seat, amounts[i]));
  }

  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <p className="eyebrow">
          {isPoints ? "Dots" : "Wolf"} · {round.course.name} · {formatDate(round.playedOn)}
        </p>
        <h1>
          {who} <span>{verb}</span>
        </h1>
        <div className={styles.actions}>
          <ShareButton />
          <a className="button button-secondary" href={isPoints ? "/golf/points" : "/golf/wolf"}>
            Start a new round
          </a>
        </div>
      </section>

      {isPoints && round.teamPoints && (
        <div className={styles.teamScore} style={{ maxWidth: 520 }}>
          {(["black", "white"] as Team[]).map((team) => (
            <div key={team} className={team === "black" ? styles.teamBlack : styles.teamWhite}>
              <small>{TEAM_NAMES[team]} dots</small>
              <strong>{round.teamPoints![team]}</strong>
            </div>
          ))}
        </div>
      )}

      {dots && (
        <section className={styles.card}>
          <h2>Front, back and total</h2>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th></th>
                  <th className={styles.num}>Black</th>
                  <th className={styles.num}>White</th>
                  <th>Winner</th>
                  {hasMoney && <th className={styles.num}>Bet</th>}
                </tr>
              </thead>
              <tbody>
                {dots.segments.map((seg) => (
                  <tr key={seg.key}>
                    <td>
                      <strong>{seg.label}</strong>
                    </td>
                    <td className={styles.num}>{seg.black}</td>
                    <td className={styles.num}>{seg.white}</td>
                    <td>{seg.winner ? <TeamTag team={seg.winner} /> : "Push"}</td>
                    {hasMoney && <td className={styles.num}>{seg.amount ? `$${seg.amount}` : ""}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={styles.card}>
        <h2>{isPoints ? "Players" : "Final standings"}</h2>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {!isPoints && <th>#</th>}
                <th>Player</th>
                {isPoints && <th>Team</th>}
                {!isPoints && <th className={styles.num}>Points</th>}
                <th className={styles.num}>Strokes</th>
                {isPoints && <th className={styles.num}>Result</th>}
                {hasMoney && <th className={styles.num}>{isPoints ? "Owes / wins" : `$${bet}/pt`}</th>}
              </tr>
            </thead>
            <tbody>
              {(isPoints ? round.players : ranked).map((p, i) => (
                <tr
                  key={p.seat}
                  className={(isPoints ? p.result === "win" : p.points === ranked[0].points) ? styles.winnerRow : undefined}
                >
                  {!isPoints && <td>{i + 1}</td>}
                  <td>{p.name}</td>
                  {isPoints && (
                    <td>
                      <TeamTag team={p.team} />
                    </td>
                  )}
                  {!isPoints && <td className={styles.num}>{p.points}</td>}
                  <td className={styles.num}>{p.strokes}</td>
                  {isPoints && <td className={styles.num}>{p.result ? resultLabel[p.result] : ""}</td>}
                  {hasMoney && <td className={styles.num}>{money(payoutBySeat.get(p.seat) ?? 0)}</td>}
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
                <th>{isPoints ? "Result" : "Wolf"}</th>
                {round.players.map((p) => (
                  <th key={p.seat} className={styles.num}>
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {round.holes.map((h) => {
                const ex = h.extras ?? {};
                return (
                  <tr key={h.number}>
                    <td>
                      <strong>{h.number}</strong>
                      <br />
                      <small className={styles.muted}>Par {h.par}</small>
                    </td>
                    <td>
                      {isPoints ? (
                        <>
                          {ex.bestBall ? `${TEAM_NAMES[ex.bestBall]} best ball` : "Best ball tied"}
                          <br />
                          <small className={styles.muted}>
                            Dots: B {ex.teamPoints?.black ?? 0} · W {ex.teamPoints?.white ?? 0}
                          </small>
                        </>
                      ) : (
                        <>
                          🐺 {name(h.wolfSeat)}
                          <br />
                          <small className={styles.muted}>{h.loneWolf ? "Lone Wolf" : `w/ ${name(h.partnerSeat)}`}</small>
                        </>
                      )}
                      {h.comment && <div className={styles.comment}>“{h.comment}”</div>}
                    </td>
                    {round.players.map((p) => {
                      const s = h.strokes[p.seat];
                      const label = isPoints ? scoreLabel(h.par, s) : null;
                      const sand = isPoints && ex.sandSaves?.includes(p.seat);
                      const closest = isPoints && ex.closest === p.seat;
                      return (
                        <td key={p.seat} className={styles.num}>
                          {s}
                          {!isPoints && h.points[p.seat] > 0 && <span className={styles.pts}>+{h.points[p.seat]}</span>}
                          {(label || sand || closest) && (
                            <small className={styles.muted} style={{ display: "block" }}>
                              {[label, sand && "Sand", closest && "Closest"].filter(Boolean).join(" · ")}
                            </small>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
