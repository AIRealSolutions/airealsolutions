// GPS helpers for shot tracking. A spot is [lat, lng].
import type { Team } from "./points";

export type Spot = [number, number];
export type SpotLog = Partial<Record<Team, (Spot | null)[]>>;

const isSpot = (s: unknown): s is Spot =>
  Array.isArray(s) && s.length >= 2 && Number.isFinite(s[0]) && Number.isFinite(s[1]);

/** Straight-line distance in yards (haversine). Null when either spot is missing. */
export function yardsBetween(a: unknown, b: unknown): number | null {
  if (!isSpot(a) || !isSpot(b)) return null;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return Math.round((2 * 6371008.8 * Math.asin(Math.sqrt(h))) / 0.9144);
}

/**
 * Distance of each shot: from where it was hit to where the next one was hit. The last shot runs
 * to the green when the green is mapped. Null when a spot is missing.
 */
export function shotYards(spots: (Spot | null)[], green?: Spot | null) {
  return spots.map((s, k) => (k < spots.length - 1 ? yardsBetween(s, spots[k + 1]) : yardsBetween(s, green)));
}

export const roundSpot = (lat: number, lng: number): Spot => [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6];

export type Fix = { spot: Spot; accuracy: number; at: number };

/** One GPS reading (high accuracy). Rejects with a readable message. */
export function currentFix(maxAgeMs = 10000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return reject(new Error("This phone has no GPS in the browser."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ spot: roundSpot(p.coords.latitude, p.coords.longitude), accuracy: Math.round(p.coords.accuracy), at: Date.now() }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? "Location is blocked. Allow location for this site in your browser settings."
              : "Could not get a GPS fix. Try again in the open.",
          ),
        ),
      { enableHighAccuracy: true, maximumAge: maxAgeMs, timeout: 15000 },
    );
  });
}
