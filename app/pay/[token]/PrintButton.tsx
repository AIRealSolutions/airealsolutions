"use client";

import styles from "./pay.module.css";

export default function PrintButton() {
  return <button type="button" className={styles.print} onClick={() => window.print()}>Print / Save PDF</button>;
}
