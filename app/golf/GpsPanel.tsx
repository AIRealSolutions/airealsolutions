"use client";

// GPS bar for the scorecards: turn on, yards to the green, accuracy, and the hole map.
import { useState } from "react";
import HoleMap, { type MapShot } from "./HoleMap";
import { yardsBetween, type Spot } from "./lib/geo";
import type { Gps } from "./lib/useGps";
import styles from "./golf.module.css";

export default function GpsPanel({
  gps,
  tee,
  green,
  shots = [],
  hint,
}: {
  gps: Gps;
  tee?: Spot | null;
  green?: Spot | null;
  shots?: MapShot[];
  hint?: string; // shown under the button while GPS is off
}) {
  const [showMap, setShowMap] = useState(true);
  const { on, setOn, fix, error } = gps;
  return (
    <>
      <div className={styles.gpsBar}>
        {on ? (
          <>
            {green && fix ? (
              <span>
                <span className={styles.gpsBig}>{yardsBetween(fix.spot, green)}</span> yds to green
              </span>
            ) : (
              <span className={styles.muted}>{green ? "Finding you…" : "GPS on. This hole isn't mapped yet."}</span>
            )}
            {fix && <small className={styles.muted}>±{Math.round(fix.accuracy / 0.9144)} yds</small>}
            <button type="button" className={styles.textButton} onClick={() => setShowMap(!showMap)}>
              {showMap ? "Hide map" : "Show map"}
            </button>
            <button type="button" className={styles.textButton} onClick={() => setOn(false)}>
              GPS off
            </button>
          </>
        ) : (
          <>
            <button type="button" className={styles.markButton} onClick={() => setOn(true)}>
              📍 Turn on GPS
            </button>
            {hint && <small className={styles.muted}>{hint}</small>}
          </>
        )}
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {on && showMap && <HoleMap tee={tee} green={green} me={fix?.spot} shots={shots} height={260} />}
    </>
  );
}

/** Map pin colors for players in regular rounds (one per seat). */
export const SEAT_COLORS = ["#dc2626", "#2563eb", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#475569"];
