"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDate, golfRpc, normalizeSettings, playerHref, type GolfSettings, type Tees } from "../lib/api";
import styles from "../golf.module.css";

type Player = {
  id: number;
  name: string;
  nickname: string | null;
  tees: Tees | null;
  hasLogin?: boolean;
  codePending?: boolean;
  email: string | null;
  phone: string | null;
  handicap: number | null;
  notes: string | null;
  tags: string[];
  isActive: boolean;
  createdAt: string;
  rounds: number;
  lastPlayed: string | null;
  points: number;
};
type AdminRound = { id: string; format: "wolf" | "points"; playedOn: string; course: string; submittedBy: string | null; players: string };
type AdminData = {
  settings: GolfSettings & { groupPinSet?: boolean };
  players: Player[];
  unknownNames: string[];
  rounds: AdminRound[];
  loginCode?: string; // only right after "Create sign-in code"
  loginCodeFor?: string;
};
type Tab = "settings" | "players" | "rounds" | "pins";
type PlayerForm = {
  id?: number;
  name: string;
  nickname: string;
  tees: Tees | "";
  email: string;
  phone: string;
  handicap: string;
  tags: string;
  notes: string;
  isActive: boolean;
};

const PIN_KEY = "golfbuddy.admin.pin";
const emptyForm: PlayerForm = { name: "", nickname: "", tees: "", email: "", phone: "", handicap: "", tags: "", notes: "", isActive: true };

const POINT_FIELDS: [keyof GolfSettings["games"]["points"]["rules"], string][] = [
  ["nassauFront", "Bet: front 9 ($ per player)"],
  ["nassauBack", "Bet: back 9 ($ per player)"],
  ["nassauTotal", "Bet: total ($ per player)"],
  ["bestBall", "Best ball (team, per hole)"],
  ["birdie", "Birdie"],
  ["eagleBonus", "Extra for eagle or better"],
  ["sandSave", "Sand save"],
  ["closest", "Closest to the hole"],
];
const WOLF_FIELDS: [keyof GolfSettings["games"]["wolf"]["rules"], string][] = [
  ["teamWin", "Wolf + partner win (each)"],
  ["opponentsWin", "Other side wins (each)"],
  ["loneWin", "Lone Wolf wins"],
  ["loneLoss", "Lone Wolf loses (to each opponent)"],
];

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function AdminPanel() {
  const [pin, setPin] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<Tab>("settings");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<GolfSettings | null>(null);
  const [form, setForm] = useState<PlayerForm | null>(null);
  const [search, setSearch] = useState("");
  const [pins, setPins] = useState({ groupPin: "", adminPin: "" });

  const call = async (action: string, payload: Record<string, unknown> = {}, usePin = pin, success?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await golfRpc<AdminData & { error?: string; pin?: boolean }>("golf_admin", {
        p_pin: usePin,
        p_action: action,
        p: payload,
      });
      if (result.error) {
        if (result.pin) {
          setPin("");
          setData(null);
          try {
            sessionStorage.removeItem(PIN_KEY);
          } catch {}
        }
        setError(result.error);
        return false;
      }
      setPin(usePin);
      try {
        sessionStorage.setItem(PIN_KEY, usePin);
      } catch {}
      setData(result);
      setSettings(normalizeSettings(result.settings));
      if (success) setNotice(success);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(PIN_KEY);
      if (saved) void call("get", {}, saved);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const players = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data?.players ?? [];
    if (!q) return list;
    return list.filter((p) =>
      [p.name, p.email, p.phone, p.notes, p.tags.join(" ")].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [data, search]);

  /* ---------- Locked ---------- */
  if (!data || !settings) {
    return (
      <div className={styles.scorecard}>
        <section className={styles.card}>
          <p className="eyebrow">Golf Buddy control panel</p>
          <h2>Enter the admin PIN</h2>
          {error && <p className={styles.error}>{error}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (pinInput.trim()) void call("get", {}, pinInput.trim());
            }}
          >
            <label className={styles.field}>
              <span>Admin PIN</span>
              <input
                className={styles.input}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            <button type="submit" className={`button ${styles.greenButton}`} disabled={busy}>
              {busy ? "Checking…" : "Open control panel"}
            </button>
          </form>
        </section>
      </div>
    );
  }

  const setRule = (game: "points" | "wolf", key: string, value: string) =>
    setSettings((s) =>
      s
        ? {
            ...s,
            games: {
              ...s.games,
              [game]: { ...s.games[game], rules: { ...s.games[game].rules, [key]: Math.max(0, Math.min(99, Number(value) || 0)) } },
            },
          }
        : s,
    );

  const editPlayer = (p?: Player, name?: string) =>
    setForm(
      p
        ? {
            id: p.id,
            name: p.name,
            nickname: p.nickname ?? "",
            tees: p.tees ?? "",
            email: p.email ?? "",
            phone: p.phone ?? "",
            handicap: p.handicap === null ? "" : String(p.handicap),
            tags: p.tags.join(", "),
            notes: p.notes ?? "",
            isActive: p.isActive,
          }
        : { ...emptyForm, name: name ?? "" },
    );

  const exportCsv = () => {
    const header = ["Name", "Nickname", "Tees", "Phone", "Email", "Handicap", "Tags", "Notes", "Active", "Rounds", "Last played"];
    const rows = (data.players ?? []).map((p) =>
      [p.name, p.nickname, p.tees, p.phone, p.email, p.handicap, p.tags.join("; "), p.notes, p.isActive ? "yes" : "no", p.rounds, p.lastPlayed]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "golf-buddy-players.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const tabs: [Tab, string][] = [
    ["settings", "Bets & games"],
    ["players", `Players (${data.players.length})`],
    ["rounds", "Rounds"],
    ["pins", "PINs"],
  ];

  return (
    <div>
      <section className={styles.hero} style={{ paddingBottom: 12 }}>
        <p className="eyebrow">Golf Buddy control panel</p>
        <h1>
          Run the group. <span>Keep the records.</span>
        </h1>
        <div className={styles.tabs}>
          {tabs.map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={`button ${tab === key ? styles.greenButton : "button-secondary"}`}
              onClick={() => {
                setTab(key);
                setNotice(null);
                setError(null);
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              try {
                sessionStorage.removeItem(PIN_KEY);
              } catch {}
              setPin("");
              setData(null);
            }}
          >
            Lock
          </button>
        </div>
      </section>

      {error && <p className={styles.error}>{error}</p>}
      {notice && <p className={styles.notice}>{notice}</p>}

      {tab === "settings" && (
        <div className={styles.grid2}>
          <section className={styles.card}>
            <h2>Bet price</h2>
            <label className={styles.field}>
              <span>Dollars per point (Wolf; optional per-dot bet for Dots)</span>
              <input
                className={styles.input}
                type="number"
                inputMode="decimal"
                min={0}
                max={1000}
                step="0.25"
                value={settings.betPerPoint}
                onChange={(e) => setSettings({ ...settings, betPerPoint: Math.max(0, Number(e.target.value) || 0) })}
              />
            </label>
            <p className={styles.muted}>
              Set to 0 for no money. Each round keeps the price it was played at.
              <br />
              Dots: set the front / back / total bet in the Dots box. A per-dot price here is added on top.
              <br />
              Wolf: every pair of players settles their point difference × price.
            </p>
            <label className={styles.field}>
              <span>Default game (shown first)</span>
              <select
                className={styles.select}
                value={settings.defaultGame}
                onChange={(e) => setSettings({ ...settings, defaultGame: e.target.value as "points" | "wolf" })}
              >
                <option value="points">Dots</option>
                <option value="wolf">Wolf</option>
              </select>
            </label>
          </section>

          {(["points", "wolf"] as const).map((game) => (
            <section className={styles.card} key={game}>
              <h2>{game === "points" ? "Dots" : "Wolf"}</h2>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={settings.games[game].enabled}
                  onChange={(e) =>
                    setSettings({ ...settings, games: { ...settings.games, [game]: { ...settings.games[game], enabled: e.target.checked } } })
                  }
                />
                <span>Game is on</span>
              </label>
              {(game === "points" ? POINT_FIELDS : WOLF_FIELDS).map(([key, label]) => (
                <label className={styles.ruleRow} key={key}>
                  <span>{label}</span>
                  <input
                    className={styles.input}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={99}
                    value={(settings.games[game].rules as Record<string, number>)[key]}
                    onChange={(e) => setRule(game, key, e.target.value)}
                  />
                </label>
              ))}
            </section>
          ))}

          <div>
            <button
              type="button"
              className={`button ${styles.greenButton}`}
              disabled={busy}
              onClick={() =>
                call(
                  "save_settings",
                  { betPerPoint: settings.betPerPoint, defaultGame: settings.defaultGame, games: settings.games },
                  pin,
                  "Settings saved. New rounds use them right away; open scorecards pick them up on reload.",
                )
              }
            >
              {busy ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      )}

      {tab === "players" && (
        <>
          {form && (
            <section className={styles.card}>
              <h2>{form.id ? `Edit ${form.name}` : "Add a player"}</h2>
              <div className={styles.grid2} style={{ gap: 12 }}>
                <label className={styles.field}>
                  <span>Name (as used on the scorecard)</span>
                  <input className={styles.input} value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  {form.id && form.name.trim() !== (data.players.find((x) => x.id === form.id)?.name ?? "") && (
                    <small className={styles.muted}>
                      Saving moves their posted rounds to the new name. If someone already played as that name, their rounds are combined.
                    </small>
                  )}
                </label>
                <label className={styles.field}>
                  <span>Nickname (optional)</span>
                  <input className={styles.input} value={form.nickname} maxLength={40} onChange={(e) => setForm({ ...form, nickname: e.target.value })} />
                </label>
                <label className={styles.field}>
                  <span>Usual tees</span>
                  <select className={styles.select} value={form.tees} onChange={(e) => setForm({ ...form, tees: e.target.value as Tees | "" })}>
                    <option value="">Not set</option>
                    <option value="white">White</option>
                    <option value="blue">Blue</option>
                    <option value="black">Black</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Phone</span>
                  <input className={styles.input} type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </label>
                <label className={styles.field}>
                  <span>Email</span>
                  <input className={styles.input} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </label>
                <label className={styles.field}>
                  <span>Handicap</span>
                  <input
                    className={styles.input}
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={form.handicap}
                    onChange={(e) => setForm({ ...form, handicap: e.target.value })}
                  />
                </label>
              </div>
              <label className={styles.field}>
                <span>Tags (comma separated, e.g. buyer, seller, HUD, AI client, referral)</span>
                <input className={styles.input} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
              </label>
              <label className={styles.field}>
                <span>Notes</span>
                <textarea className={styles.textarea} maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </label>
              {form.id && (
                <SignInBox
                  player={data.players.find((x) => x.id === form.id)}
                  code={data.loginCodeFor === form.name ? data.loginCode : undefined}
                  busy={busy}
                  onCode={() => call("login_code", { id: form.id }, pin)}
                  onReset={() => {
                    if (confirm(`Reset ${form.name}'s sign-in? Their PIN stops working and they're signed out everywhere.`))
                      void call("reset_login", { id: form.id }, pin, `${form.name}'s sign-in was reset.`);
                  }}
                />
              )}
              <label className={styles.checkRow}>
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                <span>Active (shows in scorecard name suggestions)</span>
              </label>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`button ${styles.greenButton}`}
                  disabled={busy}
                  onClick={async () => {
                    const ok = await call(
                      "save_player",
                      { ...form, tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean) },
                      pin,
                      `${form.name.trim()} saved.`,
                    );
                    if (ok) setForm(null);
                  }}
                >
                  Save player
                </button>
                <button type="button" className="button button-secondary" onClick={() => setForm(null)}>
                  Cancel
                </button>
                {form.id && (
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={async () => {
                      if (!confirm(`Delete ${form.name}? Their posted rounds stay.`)) return;
                      if (await call("delete_player", { id: form.id }, pin, `${form.name} deleted.`)) setForm(null);
                    }}
                  >
                    Delete player
                  </button>
                )}
              </div>
            </section>
          )}

          <section className={styles.card}>
            <div className={styles.holeHead} style={{ flexWrap: "wrap" }}>
              <h2 style={{ fontSize: "1.3rem" }}>Players</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className={`button ${styles.greenButton}`} onClick={() => editPlayer()}>
                  + Add player
                </button>
                <button type="button" className="button button-secondary" onClick={exportCsv} disabled={!data.players.length}>
                  Export CSV
                </button>
              </div>
            </div>
            <input
              className={styles.input}
              style={{ margin: "12px 0" }}
              placeholder="Search name, phone, email, tag or note"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {players.length ? (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Contact</th>
                      <th className={styles.num}>HCP</th>
                      <th className={styles.num}>Rounds</th>
                      <th>Last played</th>
                    </tr>
                  </thead>
                  <tbody>
                    {players.map((p) => (
                      <tr key={p.id} onClick={() => editPlayer(p)} style={{ cursor: "pointer", opacity: p.isActive ? 1 : 0.55 }}>
                        <td>
                          <strong>{p.name}</strong>
                          {p.nickname && <span className={styles.muted}> “{p.nickname}”</span>}
                          {p.hasLogin && <span className={styles.muted}> · signed up</span>}
                          {p.rounds > 0 && (
                            <a className={styles.playerLink} style={{ marginLeft: 8, fontSize: "0.8rem" }} href={playerHref(p.name)} onClick={(e) => e.stopPropagation()}>
                              Profile
                            </a>
                          )}
                          {p.tags.length > 0 && <small className={styles.muted} style={{ display: "block" }}>{p.tags.join(" · ")}</small>}
                        </td>
                        <td>
                          {p.phone && (
                            <a href={`tel:${p.phone}`} onClick={(e) => e.stopPropagation()}>
                              {p.phone}
                            </a>
                          )}
                          {p.email && (
                            <small style={{ display: "block" }}>
                              <a href={`mailto:${p.email}`} onClick={(e) => e.stopPropagation()}>
                                {p.email}
                              </a>
                            </small>
                          )}
                        </td>
                        <td className={styles.num}>{p.handicap ?? ""}</td>
                        <td className={styles.num}>{p.rounds}</td>
                        <td>{p.lastPlayed ? formatDate(p.lastPlayed) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.muted}>{search ? "No players match." : "No players yet. Add your group."}</p>
            )}
          </section>

          {data.unknownNames.length > 0 && (
            <section className={styles.card}>
              <h2>Names from posted rounds</h2>
              <p className={styles.muted}>
                These players have played but aren&apos;t in your list yet. Tap one to add their details, or add them all at once.
              </p>
              <p>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => call("import_names", {}, pin, `${data.unknownNames.length} players added.`)}
                >
                  Add all {data.unknownNames.length}
                </button>
              </p>
              <div className={styles.chips}>
                {data.unknownNames.map((n) => (
                  <button type="button" key={n} className={styles.chip} onClick={() => editPlayer(undefined, n)}>
                    + {n}
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {tab === "rounds" && (
        <section className={styles.card}>
          <h2>Posted rounds</h2>
          {data.rounds.length ? (
            <ul className={styles.list}>
              {data.rounds.map((r) => (
                <li key={r.id} className={styles.roundRow}>
                  <a href={`/golf/rounds/${r.id}`} target="_blank" rel="noreferrer">
                    <strong>{r.format === "points" ? "Dots" : "Wolf"}</strong> · {r.course}
                    <small>
                      {formatDate(r.playedOn)} · {r.players}
                      {r.submittedBy ? ` · kept by ${r.submittedBy}` : ""}
                    </small>
                  </a>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => {
                      if (confirm("Delete this round? It comes off the leaderboard and records.")) void call("delete_round", { id: r.id }, pin, "Round deleted.");
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>No rounds posted yet.</p>
          )}
        </section>
      )}

      {tab === "pins" && (
        <section className={styles.card} style={{ maxWidth: 640 }}>
          <h2>PINs</h2>
          <p className={styles.muted}>
            The group PIN is shared with your golf group and is needed to post a round. The admin PIN opens this panel.
            Use 4 to 8 digits. Leave a box empty to keep that PIN.
          </p>
          {(["groupPin", "adminPin"] as const).map((key) => (
            <label className={styles.field} key={key}>
              <span>New {key === "groupPin" ? "group" : "admin"} PIN</span>
              <input
                className={styles.input}
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={8}
                value={pins[key]}
                onChange={(e) => setPins({ ...pins, [key]: e.target.value.replace(/\D/g, "") })}
              />
            </label>
          ))}
          <button
            type="button"
            className={`button ${styles.greenButton}`}
            disabled={busy || (!pins.groupPin && !pins.adminPin)}
            onClick={async () => {
              const ok = await call("set_pins", pins, pin, "PINs updated.");
              if (ok && pins.adminPin) {
                setPin(pins.adminPin);
                try {
                  sessionStorage.setItem(PIN_KEY, pins.adminPin);
                } catch {}
              }
              if (ok) setPins({ groupPin: "", adminPin: "" });
            }}
          >
            Save PINs
          </button>
        </section>
      )}
    </div>
  );
}

/** Player sign-in (/golf/me): create a one-time code to text them, or reset their PIN. */
function SignInBox({
  player,
  code,
  busy,
  onCode,
  onReset,
}: {
  player?: Player;
  code?: string;
  busy: boolean;
  onCode: () => void;
  onReset: () => void;
}) {
  const site = typeof window === "undefined" ? "" : window.location.origin;
  const text = code && player ? `Golf Buddy sign-in: open ${site}/golf/me, enter your name (${player.name}) and code ${code}. Then pick your own PIN.` : "";
  return (
    <fieldset className={styles.betBox}>
      <legend>Player sign-in</legend>
      <p className={styles.muted} style={{ marginTop: 0 }}>
        {player?.hasLogin
          ? "Signed up: they sign in at /golf/me with their own PIN."
          : player?.codePending
            ? "Sign-in code sent, waiting for them to sign in and choose a PIN."
            : "Not set up. Create a sign-in code and text it to them."}
      </p>
      {code && (
        <div className={styles.notice}>
          Sign-in code: <strong style={{ fontSize: "1.3rem", letterSpacing: 2 }}>{code}</strong>
          <small style={{ display: "block", fontWeight: 400 }}>
            Shown once. Good for 14 days. Text it to {player?.name}.
          </small>
          {text && (
            <p style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "8px 0 0" }}>
              {player?.phone && (
                <a className="text-link" style={{ marginTop: 0 }} href={`sms:${player.phone}?&body=${encodeURIComponent(text)}`}>
                  Text it
                </a>
              )}
              <button type="button" className={styles.textButton} onClick={() => void navigator.clipboard?.writeText(text)}>
                Copy message
              </button>
            </p>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <button type="button" className={styles.textButton} disabled={busy} onClick={onCode}>
          {player?.hasLogin ? "Create a new sign-in code (forgot PIN)" : "Create sign-in code"}
        </button>
        {(player?.hasLogin || player?.codePending) && (
          <button type="button" className={styles.textButton} disabled={busy} onClick={onReset}>
            Reset sign-in
          </button>
        )}
      </div>
    </fieldset>
  );
}
