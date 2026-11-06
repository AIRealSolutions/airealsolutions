"use client";

import { useState } from "react";
import HoleMap, { type MapShot } from "../../HoleMap";
import { shotYards, type Spot } from "../../lib/geo";
import styles from "../../golf.module.css";

/** One ball's path on a hole: a team's ball (captain's choice) or a player's own ball. */
export type ShotTrack = { name: string; color: string; spots: (Spot | null)[]; who: string[] };
export type ShotMapHole = { number: number; par: number; tee: Spot | null; green: Spot | null; tracks: ShotTrack[] };

/** Posted round: pick a hole and see where every shot was hit from, with yards. */
export default function ShotMap({ holes }: { holes: ShotMapHole[] }) {
  const [number, setNumber] = useState(holes[0]?.number ?? 1);
  const hole = holes.find((h) => h.number === number) ?? holes[0];
  if (!hole) return null;
  const shots: MapShot[] = hole.tracks.flatMap((t) =>
    t.spots.flatMap((spot, k) => (spot ? [{ spot, label: (t.who[k] || t.name || String(k + 1)).slice(0, 1).toUpperCase(), color: t.color }] : [])),
  );
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
      {hole.tracks.map((t) => {
        const yds = shotYards(t.spots, hole.green);
        return (
          <p key={t.name} className={styles.holeMeta} style={{ margin: "4px 0" }}>
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 99, background: t.color, border: "1px solid #999", marginRight: 6 }} />
            <strong>{t.name}:</strong>{" "}
            {t.spots.map((_, k) => `${t.who[k] && t.who[k] !== t.name ? `${t.who[k]} ` : ""}${yds[k] !== null ? `${yds[k]} yds` : "–"}`).join(" → ")}
          </p>
        );
      })}
    </>
  );
}
