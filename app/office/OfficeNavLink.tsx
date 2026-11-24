"use client";

import { useEffect, useState } from "react";
import { checkAdmin } from "./lib/client";

/** An "Office" link for site headers that only appears for AI Real Solutions administrators. */
export default function OfficeNavLink({ className }: { className?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    checkAdmin().then(setShow, () => setShow(false));
  }, []);
  return show ? <a className={className} href="/office">Office</a> : null;
}
