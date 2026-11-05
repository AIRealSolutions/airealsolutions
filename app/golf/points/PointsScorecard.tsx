"use client";

import { useEffect, useMemo, useState } from "react";
import type { Course, GolfSettings } from "../lib/api";
import { money, settleTeams } from "../lib/settle";
import PostRound, { RosterList } from "../PostRound";
import {
  TEAM_NAMES,
  TEAMS,
  isPointsHoleComplete,
  pointsTotals,
  scoreLabel,
  scorePointsHole,
  type PointsHoleInput,
  type Team,
} from "../lib/points";
import styles from "../golf.module.css";

type HoleEntry = { strokes: (number | null)[]; sandSaves: boolean[]; closest: number | null; comment: string };
type Draft = {
  phase: "setup" | "play" | "review";
  courseId: number | null;
  playedOn: string;
  players: string[];
  teams: Team[];
  submittedBy: string;
  holes: HoleEntry[];
  current: number;
};

const STORAGE_KEY = "golfbuddy.points.draft.v1";
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const newDraft = (courseId: number | null): Draft => ({
  phase: "setup",
  courseId,
  playedOn: today(),
  players: ["", "", "", ""],
  teams: ["black", "white", "black", "white"],
  submittedBy: "",
  holes: [],
  current: 0,
});

function TeamTag({ team }: { team: Team }) {
  return <span className={`${styles.teamTag} ${team === "black" ? styles.teamBlack : styles.teamWhite}`}>{TEAM_NAMES[team]}</span>;
}

export default function PointsScorecard({
  courses,
  settings,
  roster,
}: {
  courses: Course[];
  settings: GolfSettings;
  roster: string[];
}) {
  const rules = settings.games.points.rules;
  const bet = settings.betPerPoint;
  const [draft, setDraft] = useState<Draft>(() => newDraft(courses[0]?.id ?? null));
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const { players: names, teams } = draft;
  const n = names.length;
  const holeInputs: PointsHoleInput[] = useMemo(
    () => draft.holes.map((h, i) => ({ ...h, par: course?.holes[i]?.par ?? 4, teams })),
    [draft.holes, teams, course],
  );
  const running = useMemo(() => pointsTotals(holeInputs, n, rules), [holeInputs, n, rules]);
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

  const teamScore = (
    <div className={styles.teamScore} aria-live="polite">
      {TEAMS.map((team) => (
        <div key={team} className={team === "black" ? styles.teamBlack : styles.teamWhite}>
          <small>{TEAM_NAMES[team]}</small>
          <strong>{running.team[team]}</strong>
        </div>
      ))}
    </div>
  );

  /* ---------- Setup ---------- */
  if (draft.phase === "setup") {
    const shuffle = () => {
      const order = names.map((_, i) => i).sort(() => Math.random() - 0.5);
      const next = [...teams];
      order.forEach((seat, k) => (next[seat] = k % 2 === 0 ? "black" : "white"));
      update({ teams: next });
    };
    const start = () => {
      const cleaned = names.map((p) => p.trim());
      if (!course) return setError("Pick a course.");
      if (cleaned.some((p) => !p)) return setError("Enter a name for every player, or remove the empty spot.");
      if (new Set(cleaned.map((p) => p.toLowerCase())).size !== cleaned.length)
        return setError("Each player needs a different name.");
      if (!teams.includes("black") || !teams.includes("white")) return setError("Each team needs at least one player.");
      setError(null);
      update({
        players: cleaned,
        phase: "play",
        current: 0,
        holes: course.holes.map(() => ({
          strokes: cleaned.map(() => null),
          sandSaves: cleaned.map(() => false),
          closest: null,
          comment: "",
        })),
      });
    };
    return (
      <div className={styles.scorecard}>
        <section className={styles.card}>
          <p className="eyebrow">New Team Points round</p>
          <h2>Pick the teams</h2>
          {error && <p className={styles.error}>{error}</p>}
          <label className={styles.field}>
            <span>Course</span>
            <select className={styles.select} value={draft.courseId ?? ""} onChange={(e) => update({ courseId: Number(e.target.value) })}>
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
            <span>Players and teams (2 to 8). Tap the team to switch.</span>
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
                <button
                  type="button"
                  className={`${styles.teamToggle} ${teams[i] === "black" ? styles.teamBlack : styles.teamWhite}`}
                  aria-label={`${name || `Player ${i + 1}`} is on ${TEAM_NAMES[teams[i]]}. Switch team.`}
                  onClick={() => update({ teams: teams.map((t, j) => (j === i ? (t === "black" ? "white" : "black") : t)) })}
                >
                  {TEAM_NAMES[teams[i]]}
                </button>
                {n > 2 && (
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Remove player ${i + 1}`}
                    onClick={() => update({ players: names.filter((_, j) => j !== i), teams: teams.filter((_, j) => j !== i) })}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <RosterList names={roster} />
            <p style={{ display: "flex", gap: 16, margin: 0 }}>
              {n < 8 && (
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => update({ players: [...names, ""], teams: [...teams, n % 2 === 0 ? "black" : "white"] })}
                >
                  + Add a player
                </button>
              )}
              <button type="button" className={styles.textButton} onClick={shuffle}>
                Shuffle teams
              </button>
            </p>
          </div>
          <label className={styles.field}>
            <span>Your name (optional, shown as scorekeeper)</span>
            <input className={styles.input} value={draft.submittedBy} maxLength={60} onChange={(e) => update({ submittedBy: e.target.value })} />
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

  /* ---------- Review & submit ---------- */
  if (draft.phase === "review") {
    const completed = holeInputs.map((h, i) => ({ h, i })).filter(({ h }) => isPointsHoleComplete(h));
    const payouts = settleTeams(teams, running.team, bet);
    const buildPayload = () =>
      completed.length
        ? {
            format: "points",
            courseId: course.id,
            playedOn: draft.playedOn,
            submittedBy: draft.submittedBy,
            settings: { format: "points", rules, betPerPoint: bet },
            players: names,
            teams,
            holes: completed.map(({ h, i }) => {
              const outcome = scorePointsHole(h, rules)!;
              return {
                number: course.holes[i].number,
                par: course.holes[i].par,
                strokes: h.strokes,
                points: outcome.points,
                extras: {
                  sandSaves: h.sandSaves.flatMap((on, seat) => (on ? [seat] : [])),
                  closest: h.closest,
                  bestBall: outcome.bestBall,
                  teamPoints: outcome.teamPoints,
                },
                comment: draft.holes[i].comment.trim(),
              };
            }),
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
          {teamScore}
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Team</th>
                  <th className={styles.num}>Strokes</th>
                  <th className={styles.num}>Bonus pts</th>
                  {bet > 0 && <th className={styles.num}>${bet}/pt</th>}
                </tr>
              </thead>
              <tbody>
                {names.map((name, i) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>
                      <TeamTag team={teams[i]} />
                    </td>
                    <td className={styles.num}>
                      {completed.reduce((sum, { h }) => sum + (h.strokes[i] as number), 0)}
                    </td>
                    <td className={styles.num}>{running.player[i]}</td>
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
  const outcome = scorePointsHole(holeInputs[i], rules);
  const setStroke = (seat: number, delta: number) => {
    const current = entry.strokes[seat] ?? hole.par;
    const next = entry.strokes[seat] === null ? hole.par : Math.min(15, Math.max(1, current + delta));
    updateHole(i, { strokes: entry.strokes.map((s, j) => (j === seat ? next : s)) });
  };
  const yards = [hole.yardsWhite && `${hole.yardsWhite} white`, hole.yardsBlue && `${hole.yardsBlue} blue`].filter(Boolean).join(" · ");

  return (
    <div className={styles.scorecard}>
      <section className={styles.card}>
        {teamScore}
        <div className={styles.holeHead} style={{ marginTop: 16 }}>
          <h2>Hole {hole.number}</h2>
          <span className={styles.holeMeta}>
            Par {hole.par}
            {hole.handicap ? ` · HCP ${hole.handicap}` : ""}
          </span>
        </div>
        {yards && <p className={styles.holeMeta}>{yards}</p>}

        {names.map((name, seat) => {
          const s = entry.strokes[seat];
          const label = s ? scoreLabel(hole.par, s) : null;
          return (
            <div className={styles.strokeRow} key={name}>
              <div>
                <strong>
                  {name}
                  {outcome && outcome.points[seat] > 0 && <span className={styles.pts}>+{outcome.points[seat]}</span>}
                </strong>
                <small>
                  <TeamTag team={teams[seat]} />
                  {label && <span className={styles.birdie}>{label}</span>}
                </small>
                <button
                  type="button"
                  className={`${styles.chip} ${styles.chipSmall} ${entry.sandSaves[seat] ? styles.chipOn : ""}`}
                  aria-pressed={entry.sandSaves[seat]}
                  onClick={() => updateHole(i, { sandSaves: entry.sandSaves.map((v, j) => (j === seat ? !v : v)) })}
                >
                  Sand save
                </button>
              </div>
              <div className={styles.stepper}>
                <button type="button" aria-label={`One less stroke for ${name}`} onClick={() => setStroke(seat, -1)}>
                  −
                </button>
                <output aria-label={`${name} strokes`}>{s ?? "–"}</output>
                <button type="button" aria-label={`One more stroke for ${name}`} onClick={() => setStroke(seat, 1)}>
                  +
                </button>
              </div>
            </div>
          );
        })}

        <p className={styles.holeMeta} style={{ marginTop: 14, marginBottom: 6 }}>
          Closest to the hole
        </p>
        <div className={styles.chips}>
          {names.map((name, seat) => (
            <button
              type="button"
              key={name}
              className={`${styles.chip} ${entry.closest === seat ? styles.chipOn : ""}`}
              onClick={() => updateHole(i, { closest: entry.closest === seat ? null : seat })}
            >
              {name}
            </button>
          ))}
        </div>

        <label className={styles.field}>
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
            ? `${outcome.bestBall ? `${TEAM_NAMES[outcome.bestBall]} wins best ball.` : "Best ball tied."} This hole: Black Belt ${outcome.teamPoints.black}, White Belt ${outcome.teamPoints.white}.`
            : "Enter every score to see the points."}
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
              className={`${styles.dot} ${isPointsHoleComplete(holeInputs[idx]) ? styles.dotDone : ""} ${idx === i ? styles.dotCurrent : ""}`}
              onClick={() => update({ current: idx })}
            >
              {h.number}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.card}>
        <p style={{ margin: 0 }}>
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
