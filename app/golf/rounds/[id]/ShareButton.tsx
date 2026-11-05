"use client";

import { useState } from "react";
import styles from "../../golf.module.css";

export default function ShareButton() {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = window.location.href;
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
