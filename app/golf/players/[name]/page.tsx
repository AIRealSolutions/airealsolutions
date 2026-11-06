import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatDate, getPlayer, getPlayerStats, playerHref } from "../../lib/api";
import { getMe } from "../../lib/me";
import { getPin } from "../../lib/pin";
import { TEAM_NAMES } from "../../lib/points";
import { buildSkills, keyOf, shareIndex, TIER_LABEL } from "../../lib/skill";
import styles from "../../golf.module.css";

const TEE_LABEL = { white: "White", blue: "Blue", black: "Black" } as const;
const RESULT = { win: "W", loss: "L", tie: "T" } as const;

const decode = (raw: string) => {
  try {
    return decodeURIComponent(raw).trim().slice(0, 40);
  } catch {
    return "";
  }
};

async function load(raw: string) {
  const name = decode(raw);
  if (!name) return null;
  const pin = await getPin();
  const [profile, stats, me] = await Promise.all([getPlayer(name, pin), getPlayerStats(pin), getMe()]);
  if (!profile) return null;
  return { profile, skill: buildSkills(stats).get(keyOf(profile.name)) ?? null, isMe: me ? keyOf(me.name) === keyOf(profile.name) : false, signedIn: Boolean(me) };
}

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const data = await load((await params).name);
  if (!data) return { title: "Player not found" };
  return { title: data.profile.name, description: `${data.profile.name}'s Golf Buddy record, skill level and rounds.` };
}

export default async function PlayerPage({ params }: { params: Promise<{ name: string }> }) {
  const data = await load((await params).name);
  if (!data) notFound();
  const { profile: p, skill, isMe, signedIn } = data;
  const s = p.stats;
  const dots = p.formats.points;
  const wolf = p.formats.wolf;
  const idx = s ? shareIndex(s) : null;
  const tiles: [string, string][] = [
    ["Skill", skill && !skill.provisional ? `${skill.tier} · ${skill.rating}` : "New"],
    ["Handicap", p.handicap === null ? "–" : String(p.handicap)],
    ["Dots record", dots ? `${dots.wins}-${dots.losses}-${dots.ties}` : "–"],
    ["Wolf", wolf ? `${wolf.points} pts · ${wolf.wins} wins` : "–"],
    ["Shots used", s && s.teamShots ? `${s.shotsUsed} of ${s.teamShots}` : "–"],
    ["Share of team shots", idx === null ? "–" : `${Math.round(idx * 100)}%`],
    ["Tee shots / holed", s && s.teamShots ? `${s.teeShots} / ${s.holedShots}` : "–"],
    ["Avg vs par (per hole)", s && s.holes ? `${s.overPar >= 0 ? "+" : ""}${(s.overPar / s.holes).toFixed(2)}` : "–"],
  ];
  const partners = p.partners.filter((x) => x.rounds > 0);
  const bestPartner = [...partners]
    .filter((x) => x.rounds >= 2)
    .sort((a, b) => b.wins / b.rounds - a.wins / a.rounds || b.rounds - a.rounds)[0];

  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <p className="eyebrow">
          <a href="/golf/players">Players</a>
          {p.tees ? ` · ${TEE_LABEL[p.tees]} tees` : ""}
          {p.memberSince ? ` · In the group since ${formatDate(p.memberSince)}` : ""}
        </p>
        <h1>
          {p.name} {p.nickname && <span>“{p.nickname}”</span>}
        </h1>
        {skill && (
          <p className={styles.lead}>
            Skill {skill.provisional ? "is still being worked out" : `level ${TIER_LABEL[skill.tier]}`}: {skill.basis}.
          </p>
        )}
        {(isMe || !signedIn) && (
          <div className={styles.actions}>
            <a className="button button-secondary" href="/golf/me">
              {isMe ? "Edit my profile" : "Is this you? Sign in"}
            </a>
          </div>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.statLeaders}>
          {tiles.filter(([label, value]) => value !== "–" || label === "Handicap").map(([label, value]) => (
            <div key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>

      {partners.length > 0 && (
        <section className={styles.card}>
          <h2>Dots partners</h2>
          {bestPartner && (
            <p className={styles.muted}>
              Best partner: <strong>{bestPartner.name}</strong> ({bestPartner.wins}-{bestPartner.losses}-{bestPartner.ties} together)
            </p>
          )}
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Teammate</th>
                  <th className={styles.num}>Rounds together</th>
                  <th className={styles.num}>Record</th>
                </tr>
              </thead>
              <tbody>
                {partners.map((x) => (
                  <tr key={x.name}>
                    <td>
                      <a className={styles.playerLink} href={playerHref(x.name)}>
                        {x.name}
                      </a>
                    </td>
                    <td className={styles.num}>{x.rounds}</td>
                    <td className={styles.num}>
                      {x.wins}-{x.losses}-{x.ties}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={styles.card}>
        <h2>Rounds</h2>
        {p.rounds.length ? (
          <ul className={styles.list}>
            {p.rounds.map((r) => (
              <li key={r.id}>
                <a href={`/golf/rounds/${r.id}`}>
                  <strong>
                    {r.format === "points"
                      ? `${r.result ? `${RESULT[r.result]} · ` : ""}${r.team ? TEAM_NAMES[r.team] : "Dots"}${r.scramble ? " · Captain's choice" : ""}`
                      : `Wolf · ${r.points} pts`}
                  </strong>{" "}
                  at {r.course}
                  <small>
                    {formatDate(r.playedOn)}
                    {!r.scramble && r.strokes ? ` · ${r.strokes} strokes` : ""}
                    {r.with ? ` · with ${r.with}` : ""}
                  </small>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>No rounds posted yet.</p>
        )}
      </section>
    </div>
  );
}
