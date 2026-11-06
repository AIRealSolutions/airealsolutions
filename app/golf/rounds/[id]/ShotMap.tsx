"use client";

import { useState } from "react";
import HoleMap, { type MapShot } from "../../HoleMap";
import { shotYards, type Spot } from "../../lib/geo";
import { TEAM_NAMES, type Team } from "../../lib/points";
import styles from "../../golf.module.css";

export type ShotMapHole = {
  number: number;
  par: number;
  tee: Spot | null;
  green: Spot | null;
  teams: Partial<Record<Team, { spots: (Spot | null)[]; who: string[] }>>;
};

/** Posted round: pick a hole and see where each team's shots were hit from, with yards. */
export default function ShotMap({ holes }: { holes: ShotMapHole[] }) {
  const [number, setNumber] = useState(holes[0]?.number ?? 1);
  const hole = holes.find((h) => h.number === number) ?? holes[0];
  if (!hole) return null;
  const shots: MapShot[] = (["black", "white"] as Team[]).flatMap((team) => {
    const t = hole.teams[team];
    return (t?.spots ?? []).flatMap((spot, k) =>
      spot ? [{ spot, label: (t!.who[k] || String(k + 1)).slice(0, 1).toUpperCase(), color: team === "black" ? "#111827" : "#ffffff" }] : [],
    );
  });
  return (
    <>
      <div className={styles.dots} aria-label="Pick a hole">
        {holes.map((h) => (
          <button
            type="button"
            key={h.number}
            className={`${styles.dot} ${styles.dotDone} ${h.number === hole.number ? styles.dotCurrent : ""}`}
            onClick={() => setNumber(h.number)}
          >
            {h.number}
          </button>
        ))}
      </div>
      <HoleMap tee={hole.tee} green={hole.green} shots={shots} height={300} />
      {(["black", "white"] as Team[]).map((team) => {
        const t = hole.teams[team];
        if (!t || !t.spots.some(Boolean)) return null;
        const yds = shotYards(t.spots, hole.green);
        return (
          <p key={team} className={styles.holeMeta} style={{ margin: "4px 0" }}>
            <strong>{TEAM_NAMES[team]}:</strong>{" "}
            {t.spots.map((_, k) => `${t.who[k] || "?"}${yds[k] !== null ? ` ${yds[k]} yds` : ""}`).join(" → ")}
          </p>
        );
      })}
    </>
  );
}
