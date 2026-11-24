"use client";

import { useEffect } from "react";

/** After connecting Google, come back to this page instead of the Factory's. */
export default function ReturnHere() {
  useEffect(() => {
    try { sessionStorage.setItem("airealsolutions.connections.return", "/office/factory-connections"); } catch { /* storage unavailable */ }
  }, []);
  return null;
}
