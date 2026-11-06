"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PIN_STORAGE_KEY, submitRound } from "./lib/api";
import styles from "./golf.module.css";

type Props = {
  pinRequired: boolean;
  defaultPin?: string; // the PIN this device unlocked the site with
  draftKey: string;
  buildPayload: () => Record<string, unknown> | string; // a string is a validation message
  onBack: () => void;
};

/** PIN box + "Post the round" button shared by both scorecards. */
export default function PostRound({ pinRequired, defaultPin = "", draftKey, buildPayload, onBack }: Props) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [askPin, setAskPin] = useState(pinRequired && !defaultPin);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    try {
      setPin(defaultPin || localStorage.getItem(PIN_STORAGE_KEY) || "");
    } catch {}
  }, []);

  const post = async () => {
    const payload = buildPayload();
    if (typeof payload === "string") return setError(payload);
    if (askPin && !pin.trim()) return setError("Enter the group PIN to post the round.");
    setPosting(true);
    setError(null);
    try {
      const id = await submitRound({ ...payload, pin: pin.trim() });
      try {
        localStorage.setItem(PIN_STORAGE_KEY, pin.trim());
        localStorage.removeItem(draftKey);
      } catch {}
      router.push(`/golf/rounds/${id}`);
    } catch (e) {
      const err = e as Error & { pin?: boolean };
      if (err.pin) setAskPin(true);
      setError(err.message || "Could not post the round. Your card is saved; try again.");
      setPosting(false);
    }
  };

  return (
    <>
      {askPin && (
        <label className={styles.field} style={{ marginTop: 16 }}>
          <span>Group PIN</span>
          <input
            className={styles.input}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="Ask the group organizer"
          />
        </label>
      )}
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.holeNav}>
        <button type="button" className="button button-secondary" onClick={onBack}>
          Back to the card
        </button>
        <button type="button" className={`button ${styles.greenButton}`} onClick={post} disabled={posting}>
          {posting ? "Posting…" : "Post the round"}
        </button>
      </div>
    </>
  );
}
