"use client";

import { useState } from "react";
import styles from "./golf.module.css";

const NEW = "__new__";
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Player dropdown for the scorecards: everyone in the player list, plus "Someone new…" for a guest
 * (types a name). Players already picked in another seat are greyed out.
 */
export default function PlayerPicker({
  value,
  onChange,
  roster,
  taken = [],
  label,
}: {
  value: string;
  onChange: (name: string) => void;
  roster: string[];
  taken?: string[];
  label: string;
}) {
  const names = [...new Set(roster)];
  const match = names.find((n) => same(n, value));
  const [typing, setTyping] = useState(false);
  const custom = typing || (!!value.trim() && !match) || !names.length;

  if (custom) {
    return (
      <div className={styles.pickerCustom}>
        <input
          className={styles.input}
          placeholder={names.length ? "Guest's name" : label}
          aria-label={label}
          value={value}
          maxLength={40}
          autoComplete="off"
          autoFocus={typing}
          onChange={(e) => onChange(e.target.value)}
        />
        {names.length > 0 && (
          <button
            type="button"
            className={styles.textButton}
            onClick={() => {
              setTyping(false);
              onChange("");
            }}
          >
            List
          </button>
        )}
      </div>
    );
  }

  return (
    <select
      className={styles.select}
      aria-label={label}
      value={match ?? ""}
      onChange={(e) => {
        if (e.target.value === NEW) {
          setTyping(true);
          onChange("");
        } else onChange(e.target.value);
      }}
    >
      <option value="">Pick a player</option>
      {names.map((n) => (
        <option key={n} value={n} disabled={!same(n, match ?? "") && taken.some((t) => same(t, n))}>
          {n}
        </option>
      ))}
      <option value={NEW}>+ Someone new…</option>
    </select>
  );
}
