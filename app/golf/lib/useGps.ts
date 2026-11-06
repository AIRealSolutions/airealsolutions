"use client";

// Live phone position for the scorecards (rangefinder + shot marking). Watches only while turned on.
import { useEffect, useState } from "react";
import { currentFix, roundSpot, type Fix } from "./geo";

export function useGps() {
  const [on, setOn] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!on) return;
    if (!navigator.geolocation) {
      setError("This phone has no GPS in the browser.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null);
        setFix({ spot: roundSpot(p.coords.latitude, p.coords.longitude), accuracy: Math.round(p.coords.accuracy), at: Date.now() });
      },
      (e) =>
        setError(e.code === e.PERMISSION_DENIED ? "Location is blocked. Allow location for this site in your browser settings." : "Waiting for GPS…"),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [on]);

  /** A fresh reading: the live one if it is recent, otherwise a new one. Turns GPS on. */
  const read = async () => {
    const reading = fix && Date.now() - fix.at < 10000 ? fix : await currentFix();
    setOn(true);
    setError(null);
    return reading;
  };

  return { on, setOn, fix, error, setError, read };
}

export type Gps = ReturnType<typeof useGps>;
