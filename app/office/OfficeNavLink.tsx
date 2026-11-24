"use client";

import { useEffect, useState } from "react";
import { checkAdmin } from "./lib/client";

/** A link to the Office that only appears for AI Real Solutions administrators. */
export default function OfficeNavLink({ className, label = "Office" }: { className?: string; label?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    checkAdmin().then(setShow, () => setShow(false));
  }, []);
  return show ? <a className={className} href="/office">{label}</a> : null;
}

/** A full-width bar for pages where the header menu is hidden on phones. */
export function OfficeBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    checkAdmin().then(setShow, () => setShow(false));
  }, []);
  if (!show) return null;
  return (
    <div className="office-banner">
      <span><strong>The Office</strong> — your daily plan, Incubator, CRM, billing and books.</span>
      <a className="button button-primary" href="/office">Open the Office →</a>
    </div>
  );
}
