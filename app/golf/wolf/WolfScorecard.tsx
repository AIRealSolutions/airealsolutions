"use client";

import { useEffect, useMemo, useState } from "react";
import type { Course, GolfSettings } from "../lib/api";
import { isHoleComplete, scoreHole, totals, wolfSeatFor, type HoleInput } from "../lib/wolf";
import { money, settleWolf } from "../lib/settle";
import PostRound, { RosterList } from "../PostRound";
import styles from "../golf.module.css";

type HoleEntry = { strokes: (number | null)[]; partnerSeat: number | null; loneWolf: boolean; comment: string };
type Draft = {
  bet?: number;
  phase: "setup" | "play" | "review";
  courseId: number | null;
  playedOn: string;
  players: string[];
  submittedBy: string;
  holes: HoleEntry[];
  current: number;
};

const STORAGE_KEY = "golfbuddy.wolf.draft.v1";
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const newDraft = (courseId: number | null): Draft => ({
  phase: "setup",
  courseId,
  playedOn: today(),
  players: ["", "", "", ""],
  submittedBy: "",
  holes: [],
  current: 0,
});

export default function WolfScorecard({
  courses,
  settings,
  roster,
}: {
  courses: Course[];
  settings: GolfSettings;
  roster: string[];
}) {
  const rules = settings.games.wolf.rules;
  const [draft, setDraft] = useState<Draft>(() => newDraft(courses[0]?.id ?? null));
  // Today's bet: starts from the control panel, can be changed for this round only.
  const bet = draft.bet ?? settings.betPerPoint;
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore an in-progress round (phone locked, dead zone, page reload...).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setDraft(JSON.parse(saved) as Draft);
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {}
  }, [draft, loaded]);

  const course = courses.find((c) => c.id === draft.courseId) ?? null;
  const names = draft.players;
  const n = names.length;
  const holeInputs: HoleInput[] = useMemo(
    () => draft.holes.map((h, i) => ({ ...h, wolfSeat: wolfSeatFor(i, n) })),
    [draft.holes, n],
  );
  const running = useMemo(() => totals(holeInputs, n, rules), [holeInputs, n, rules]);
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const updateHole = (index: number, patch: Partial<HoleEntry>) =>
    setDraft((d) => ({ ...d, holes: d.holes.map((h, i) => (i === index ? { ...h, ...patch } : h)) }));

  if (!loaded) return <section className={styles.card} aria-busy="true" style={{ minHeight: 320 }} />;

  if (!courses.length) {
    return (
      <section className={styles.card}>
        <h2>Courses are unavailable</h2>
        <p className={styles.muted}>The course list could not be loaded. Please try again in a minute.</p>
      </section>
    );
  }

  /* ---------- Setup ---------- */
  if (draft.phase === "setup") {
    const start = () => {
      const cleaned = names.map((p) => p.trim());
      if (!course) return setError("Pick a course.");
      if (cleaned.some((p) => !p)) return setError("Enter a name for every player, or remove the empty spot.");
      if (new Set(cleaned.map((p) => p.toLowerCase())).size !== cleaned.length)
        return setError("Each player needs a different name.");
      setError(null);
      update({
        players: cleaned,
        phase: "play",
        current: 0,
        holes: course.holes.map(() => ({ strokes: cleaned.map(() => null), partnerSeat: null, loneWolf: false, comment: "" })),
      });
    };
    return (
      <div className={styles.scorecard}>
        <section className={styles.card}>
          <p className="eyebrow">New Wolf round</p>
          <h2>Who's playing?</h2>
          {error && <p className={styles.error}>{error}</p>}
          <label className={styles.field}>
            <span>Course</span>
            <select
              className={styles.select}
              value={draft.courseId ?? ""}
              onChange={(e) => update({ courseId: Number(e.target.value) })}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.city ? ` · ${c.city}, ${c.state ?? ""}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Date played</span>
            <input className={styles.input} type="date" value={draft.playedOn} onChange={(e) => update({ playedOn: e.target.value })} />
          </label>
          <div className={styles.field}>
            <span>Players in tee order (3 to 5)</span>
            {names.map((name, i) => (
              <div className={styles.playerRow} key={i}>
                <input
                  className={styles.input}
                  placeholder={`Player ${i + 1}`}
                  value={name}
                  maxLength={40}
                  autoComplete="off"
                  list="golf-roster"
                  onChange={(e) => update({ players: names.map((p, j) => (j === i ? e.target.value : p)) })}
                />
                {n > 3 && (
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Remove player ${i + 1}`}
                    onClick={() => update({ players: names.filter((_, j) => j !== i) })}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <RosterList names={roster} />
            {n < 5 && (
              <button type="button" className={styles.textButton} onClick={() => update({ players: [...names, ""] })}>
                + Add a player
              </button>
            )}
          </div>
          <label className={styles.field}>
            <span>Today's bet ($ per point, 0 for no money)</span>
            <input
              className={styles.input}
              type="number"
              inputMode="decimal"
              min={0}
              max={1000}
              step="0.25"
              value={bet}
              onChange={(e) => update({ bet: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) })}
            />
          </label>
          <label className={styles.field}>
            <span>Your name (optional, shown as scorekeeper)</span>
            <input
              className={styles.input}
              value={draft.submittedBy}
              maxLength={60}
              onChange={(e) => update({ submittedBy: e.target.value })}
            />
          </label>
          <button type="button" className={`button ${styles.greenButton}`} onClick={start}>
            Tee off
          </button>
        </section>
      </div>
    );
  }

  if (!course) {
    return (
      <section className={styles.card}>
        <h2>That course is no longer available</h2>
        <button type="button" className="button button-secondary" onClick={() => setDraft(newDraft(courses[0].id))}>
          Start over
        </button>
      </section>
    );
  }

  const leaderboardStrip = (
    <div className={styles.running} aria-live="polite">
      {names.map((name, i) => (
        <span key={name}>
          {name}: <strong>{running.points[i]}</strong>
        </span>
      ))}
    </div>
  );

  /* ---------- Review & submit ---------- */
  if (draft.phase === "review") {
    const completed = holeInputs.map((h, i) => ({ h, i })).filter(({ h }) => isHoleComplete(h));
    const payouts = settleWolf(running.points, bet);
    const buildPayload = () =>
      completed.length
        ? {
            courseId: course.id,
            playedOn: draft.playedOn,
            submittedBy: draft.submittedBy,
            settings: { format: "wolf", rules: { ...rules, betPerPoint: bet }, betPerPoint: bet },
            players: names,
            holes: completed.map(({ h, i }) => ({
              number: course.holes[i].number,
              par: course.holes[i].par,
              wolfSeat: h.wolfSeat,
              partnerSeat: h.loneWolf ? null : h.partnerSeat,
              loneWolf: h.loneWolf,
              strokes: h.strokes,
              points: scoreHole(h, rules)!.points,
              comment: draft.holes[i].comment.trim(),
            })),
          }
        : "Finish at least one hole before posting the round.";
    return (
      <div className={styles.scorecard}>
        <section className={styles.card}>
          <p className="eyebrow">Review</p>
          <h2>{course.name}</h2>
          <p className={styles.muted}>
            {completed.length} of {course.holes.length} holes complete. Unfinished holes are left off.
          </p>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Player</th>
                  <th className={styles.num}>Strokes</th>
                  <th className={styles.num}>Points</th>
                  {bet > 0 && <th className={styles.num}>${bet}/pt</th>}
                </tr>
              </thead>
              <tbody>
                {names.map((name, i) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td className={styles.num}>{running.strokes[i]}</td>
                    <td className={styles.num}>{running.points[i]}</td>
                    {bet > 0 && <td className={styles.num}>{money(payouts[i])}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PostRound
            pinRequired={settings.pinRequired}
            draftKey={STORAGE_KEY}
            buildPayload={buildPayload}
            onBack={() => update({ phase: "play" })}
          />
        </section>
      </div>
    );
  }

  /* ---------- Hole by hole ---------- */
  const i = draft.current;
  const hole = course.holes[i];
  const entry = draft.holes[i];
  const input = holeInputs[i];
  const wolf = input.wolfSeat;
  const outcome = scoreHole(input, rules);
  const setStroke = (seat: number, delta: number) => {
    const current = entry.strokes[seat] ?? hole.par;
    const next = entry.strokes[seat] === null ? hole.par : Math.min(15, Math.max(1, current + delta));
    updateHole(i, { strokes: entry.strokes.map((s, j) => (j === seat ? next : s)) });
  };
  const yards = [hole.yardsWhite && `${hole.yardsWhite} white`, hole.yardsBlue && `${hole.yardsBlue} blue`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={styles.scorecard}>
      <section className={styles.card}>
        <div className={styles.holeHead}>
          <h2>Hole {hole.number}</h2>
          <span className={styles.holeMeta}>
            Par {hole.par}
            {hole.handicap ? ` · HCP ${hole.handicap}` : ""}
          </span>
        </div>
        {yards && <p className={styles.holeMeta}>{yards}</p>}
        <span className={styles.wolfBadge}>🐺 {names[wolf]} is the Wolf</span>

        <p className={styles.holeMeta}>After the tee shots, {names[wolf]} picks:</p>
        <div className={styles.chips}>
          {names.map((name, seat) =>
            seat === wolf ? null : (
              <button
                type="button"
                key={name}
                className={`${styles.chip} ${!entry.loneWolf && entry.partnerSeat === seat ? styles.chipOn : ""}`}
                onClick={() => updateHole(i, { partnerSeat: seat, loneWolf: false })}
              >
                {name}
              </button>
            ),
          )}
          <button
            type="button"
            className={`${styles.chip} ${styles.chipLone} ${entry.loneWolf ? styles.chipOn : ""}`}
            onClick={() => updateHole(i, { loneWolf: true, partnerSeat: null })}
          >
            Lone Wolf
          </button>
        </div>

        {names.map((name, seat) => (
          <div className={styles.strokeRow} key={name}>
            <div>
              <strong>
                {name}
                {outcome && outcome.points[seat] > 0 && <span className={styles.pts}>+{outcome.points[seat]}</span>}
              </strong>
              <small>
                {seat === wolf ? "Wolf" : !entry.loneWolf && entry.partnerSeat === seat ? "Partner" : ""}
              </small>
            </div>
            <div className={styles.stepper}>
              <button type="button" aria-label={`One less stroke for ${name}`} onClick={() => setStroke(seat, -1)}>
                −
              </button>
              <output aria-label={`${name} strokes`}>{entry.strokes[seat] ?? "–"}</output>
              <button type="button" aria-label={`One more stroke for ${name}`} onClick={() => setStroke(seat, 1)}>
                +
              </button>
            </div>
          </div>
        ))}

        <label className={styles.field} style={{ marginTop: 14 }}>
          <span>Comment on this hole</span>
          <textarea
            className={styles.textarea}
            maxLength={500}
            placeholder="Chip-in, lost ball, trash talk…"
            value={entry.comment}
            onChange={(e) => updateHole(i, { comment: e.target.value })}
          />
        </label>

        <p className={styles.holeMeta}>
          {outcome
            ? outcome.winner === "push"
              ? "Tied hole. No points."
              : outcome.winner === "wolf"
                ? entry.loneWolf
                  ? `Lone Wolf wins! ${names[wolf]} takes the points.`
                  : "Wolf side wins the hole."
                : "The other side wins the hole."
            : "Pick the Wolf's partner and enter every score to see points."}
        </p>

        <div className={styles.holeNav}>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => (i === 0 ? update({ phase: "setup" }) : update({ current: i - 1 }))}
          >
            {i === 0 ? "Setup" : "← Prev"}
          </button>
          {i < course.holes.length - 1 ? (
            <button type="button" className={`button ${styles.greenButton}`} onClick={() => update({ current: i + 1 })}>
              Next hole →
            </button>
          ) : (
            <button type="button" className={`button ${styles.greenButton}`} onClick={() => update({ phase: "review" })}>
              Finish round
            </button>
          )}
        </div>

        <div className={styles.dots} aria-label="Jump to hole">
          {course.holes.map((h, idx) => (
            <button
              type="button"
              key={h.number}
              className={`${styles.dot} ${isHoleComplete(holeInputs[idx]) ? styles.dotDone : ""} ${idx === i ? styles.dotCurrent : ""}`}
              onClick={() => update({ current: idx })}
            >
              {h.number}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.card}>
        <h2>Points so far</h2>
        {leaderboardStrip}
        <p style={{ marginTop: 14, marginBottom: 0 }}>
          <button type="button" className={styles.textButton} onClick={() => update({ phase: "review" })}>
            Review and post the round
          </button>
          {" · "}
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              if (confirm("Throw away this scorecard?")) setDraft(newDraft(courses[0].id));
            }}
          >
            Discard
          </button>
        </p>
      </section>
    </div>
  );
}
