"use client";

import { useState } from "react";
import { SITE_URL } from "../../lib/api";
import styles from "../../golf.module.css";

export default function ShareButton() {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    // Always share the public address, never a Vercel deployment URL (those ask friends to sign in).
    const url = `${SITE_URL}${window.location.pathname}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: document.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return (
    <button type="button" className={`button ${styles.greenButton}`} onClick={share}>
      {copied ? "Link copied" : "Share with the group"}
    </button>
  );
}
