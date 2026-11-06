"use client";

// Control panel → Course maps: put a tee pin and a green pin on every hole (satellite map), once per course.
import { useEffect, useMemo, useState } from "react";
import { golfRpc, type Course } from "../lib/api";
import { currentFix, yardsBetween, type Spot } from "../lib/geo";
import HoleMap from "../HoleMap";
import styles from "../golf.module.css";

type Pins = { tee: Spot | null; green: Spot | null };
type Layout = Record<number, Pins>; // by hole number

const NINES = { front: [1, 9], back: [10, 18] } as const;
type Nine = keyof typeof NINES;

export default function CourseMaps({
  pin,
  busy,
  save,
}: {
  pin: string;
  busy: boolean;
  save: (courseId: number, holes: { number: number; tee: Spot | null; green: Spot | null }[], label: string) => Promise<boolean>;
}) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [layout, setLayout] = useState<Layout>({});
  const [hole, setHole] = useState(1);
  const [place, setPlace] = useState<"tee" | "green">("tee");
  const [center, setCenter] = useState<Spot | null>(null);
  const [search, setSearch] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [copyFrom, setCopyFrom] = useState({ course: 0, from: "front" as Nine, to: "front" as Nine });

  const load = async (keep?: number) => {
    const list = (await golfRpc<Course[] | null>("golf_courses", { p_pin: pin })) ?? [];
    setCourses(list);
    const id = keep ?? courseId ?? list[0]?.id ?? null;
    pick(id, list);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (id: number | null, list = courses) => {
    const c = list.find((x) => x.id === id);
    setCourseId(id);
    setDirty(false);
    setHole(1);
    setPlace("tee");
    setNote(null);
    setLayout(Object.fromEntries((c?.holes ?? []).map((h) => [h.number, { tee: h.tee ?? null, green: h.green ?? null }])));
    setSearch(c ? `${c.name.split("·")[0].trim()} golf, ${c.city ?? ""} ${c.state ?? ""}`.trim() : "");
    const any = (c?.holes ?? []).find((h) => h.tee || h.green);
    setCenter(any ? (any.tee ?? any.green)! : null);
  };

  const course = courses.find((c) => c.id === courseId) ?? null;
  const pins = layout[hole] ?? { tee: null, green: null };
  const info = course?.holes.find((h) => h.number === hole);
  const mapped = useMemo(() => Object.values(layout).filter((p) => p.tee && p.green).length, [layout]);
  const set = (patch: Partial<Pins>, number = hole) => {
    setLayout((l) => ({ ...l, [number]: { ...(l[number] ?? { tee: null, green: null }), ...patch } }));
    setDirty(true);
  };
  const neighbor = layout[hole - 1]?.green ?? layout[hole + 1]?.tee ?? null;

  const find = async () => {
    if (!search.trim()) return;
    setWorking(true);
    setNote(null);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(search)}`);
      const hit = ((await res.json()) as { lat: string; lon: string }[])[0];
      if (!hit) setNote("Not found. Try the course name and town, or use your location.");
      else setCenter([Number(hit.lat), Number(hit.lon)]);
    } catch {
      setNote("Search is unavailable right now.");
    } finally {
      setWorking(false);
    }
  };

  const here = async (which: "tee" | "green") => {
    setWorking(true);
    try {
      const f = await currentFix(2000);
      set({ [which]: f.spot });
      setNote(`${which === "tee" ? "Tee" : "Green"} set from your location (±${Math.round(f.accuracy / 0.9144)} yds).`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "No GPS.");
    } finally {
      setWorking(false);
    }
  };

  /** Pulls golf holes (OpenStreetMap "golf=hole" lines) near the map and matches them by hole number. */
  const importOsm = async () => {
    const at = center ?? pins.tee ?? pins.green;
    if (!at) return setNote("Find the course on the map first.");
    setWorking(true);
    setNote(null);
    try {
      const q = `[out:json][timeout:25];way["golf"="hole"](around:3000,${at[0]},${at[1]});out geom tags;`;
      const res = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: q }) });
      const data = (await res.json()) as { elements: { tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[] };
      let n = 0;
      const next = { ...layout };
      for (const el of data.elements ?? []) {
        const ref = Number(el.tags?.ref);
        const g = el.geometry ?? [];
        if (!Number.isInteger(ref) || !next[ref] || g.length < 2) continue;
        next[ref] = { tee: [g[0].lat, g[0].lon], green: [g[g.length - 1].lat, g[g.length - 1].lon] };
        n++;
      }
      setLayout(next);
      if (n) setDirty(true);
      setNote(
        n
          ? `Imported ${n} hole${n === 1 ? "" : "s"} from OpenStreetMap. Check each one (holes on 27-hole courses can be numbered by nine), then save.`
          : "OpenStreetMap has no numbered holes here. Place the pins by hand.",
      );
    } catch {
      setNote("OpenStreetMap is unavailable right now. Place the pins by hand.");
    } finally {
      setWorking(false);
    }
  };

  const copyNine = () => {
    const src = courses.find((c) => c.id === copyFrom.course);
    if (!src) return;
    const [a] = NINES[copyFrom.from];
    const [b] = NINES[copyFrom.to];
    const next = { ...layout };
    let n = 0;
    for (let k = 0; k < 9; k++) {
      const h = src.holes.find((x) => x.number === a + k);
      if (h && (h.tee || h.green) && next[b + k]) {
        next[b + k] = { tee: h.tee ?? null, green: h.green ?? null };
        n++;
      }
    }
    setLayout(next);
    if (n) setDirty(true);
    setNote(n ? `Copied ${n} holes. Save to keep them.` : "That nine has no pins yet.");
  };

  if (!course) return <section className={styles.card}>{courses.length ? null : <p className={styles.muted}>Loading courses…</p>}</section>;
  const yds = yardsBetween(pins.tee, pins.green);
  const card = info?.yardsWhite ?? info?.yardsBlue ?? null;

  return (
    <section className={styles.card}>
      <h2>Course maps</h2>
      <p className={styles.muted}>
        Put a tee pin and a green pin on every hole once. The scorecard then shows yards to the green and measures each
        shot. Tap the map to place a pin, or drag it.
      </p>
      <label className={styles.field}>
        <span>Course</span>
        <select
          className={styles.select}
          value={course.id}
          onChange={(e) => {
            if (dirty && !confirm("Leave without saving this course's pins?")) return;
            pick(Number(e.target.value));
          }}
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.dots} aria-label="Holes">
        {course.holes.map((h) => {
          const p = layout[h.number];
          return (
            <button
              type="button"
              key={h.number}
              className={`${styles.dot} ${p?.tee && p?.green ? styles.dotDone : ""} ${h.number === hole ? styles.dotCurrent : ""}`}
              onClick={() => {
                setHole(h.number);
                setPlace(layout[h.number]?.tee ? "green" : "tee");
              }}
            >
              {h.number}
            </button>
          );
        })}
      </div>
      <p className={styles.holeMeta}>
        {mapped} of {course.holes.length} holes mapped · Hole {hole}, par {info?.par}
        {card ? ` · card ${card} yds` : ""}
        {yds !== null ? ` · map ${yds} yds tee to green` : ""}
      </p>

      <div className={styles.gpsBar}>
        <span className={styles.muted}>Tap places the</span>
        <button type="button" className={`${styles.chip} ${styles.chipSmall} ${place === "tee" ? styles.chipOn : ""}`} onClick={() => setPlace("tee")}>
          Tee
        </button>
        <button type="button" className={`${styles.chip} ${styles.chipSmall} ${place === "green" ? styles.chipOn : ""}`} onClick={() => setPlace("green")}>
          Green
        </button>
      </div>
      <HoleMap
        editable
        tee={pins.tee}
        green={pins.green}
        center={center ?? neighbor}
        height={360}
        onTee={(s) => set({ tee: s })}
        onGreen={(s) => set({ green: s })}
        onTap={(s) => {
          set({ [place]: s });
          if (place === "tee") setPlace("green");
        }}
      />
      {note && <p className={styles.notice}>{note}</p>}

      <div className={styles.actions} style={{ marginTop: 8 }}>
        <button
          type="button"
          className={`button ${styles.greenButton}`}
          disabled={busy || working || !dirty}
          onClick={async () => {
            const holes = course.holes.map((h) => ({ number: h.number, ...(layout[h.number] ?? { tee: null, green: null }) }));
            if (await save(course.id, holes, `${course.name} map saved.`)) {
              setDirty(false);
              await load(course.id);
            }
          }}
        >
          {dirty ? "Save course map" : "Saved"}
        </button>
        {hole < course.holes.length && (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setHole(hole + 1);
              setPlace(layout[hole + 1]?.tee ? "green" : "tee");
            }}
          >
            Next hole →
          </button>
        )}
      </div>

      <details className={styles.rulesBox} style={{ marginTop: 16 }}>
        <summary>More ways to place pins</summary>
        <p className={styles.muted}>On the course? Stand on the tee or the middle of the green and use your phone&apos;s GPS:</p>
        <p style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <button type="button" className={styles.textButton} disabled={working} onClick={() => void here("tee")}>
            Tee = my location
          </button>
          <button type="button" className={styles.textButton} disabled={working} onClick={() => void here("green")}>
            Green = my location
          </button>
          {(pins.tee || pins.green) && (
            <button type="button" className={styles.textButton} onClick={() => set({ tee: null, green: null })}>
              Clear this hole
            </button>
          )}
        </p>
        <label className={styles.field}>
          <span>Find the course on the map</span>
          <span style={{ display: "flex", gap: 8 }}>
            <input className={styles.input} value={search} onChange={(e) => setSearch(e.target.value)} />
            <button type="button" className="button button-secondary" disabled={working} onClick={() => void find()}>
              Find
            </button>
          </span>
        </label>
        <p>
          <button type="button" className={styles.textButton} disabled={working} onClick={() => void importOsm()}>
            Import holes from OpenStreetMap
          </button>
        </p>
        <div className={styles.field}>
          <span>Copy a nine from another course (same nine, different combination)</span>
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select className={styles.select} style={{ flex: "1 1 180px" }} value={copyFrom.course} onChange={(e) => setCopyFrom({ ...copyFrom, course: Number(e.target.value) })}>
              <option value={0}>From course…</option>
              {courses
                .filter((c) => c.id !== course.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <select className={styles.select} style={{ flex: "1 1 110px" }} value={copyFrom.from} onChange={(e) => setCopyFrom({ ...copyFrom, from: e.target.value as Nine })}>
              <option value="front">its holes 1–9</option>
              <option value="back">its holes 10–18</option>
            </select>
            <select className={styles.select} style={{ flex: "1 1 110px" }} value={copyFrom.to} onChange={(e) => setCopyFrom({ ...copyFrom, to: e.target.value as Nine })}>
              <option value="front">into 1–9</option>
              <option value="back">into 10–18</option>
            </select>
            <button type="button" className="button button-secondary" disabled={!copyFrom.course} onClick={copyNine}>
              Copy
            </button>
          </span>
        </div>
      </details>
    </section>
  );
}
