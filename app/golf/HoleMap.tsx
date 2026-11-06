"use client";

// Satellite map of one hole (Leaflet + Esri World Imagery, no key needed). Shows the tee, the green,
// shot spots joined by lines, and optionally the phone's position. In edit mode the tee and green
// pins can be dragged, and a tap on the map can place one.
import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Spot } from "./lib/geo";
import styles from "./golf.module.css";

export type MapShot = { spot: Spot; label: string; color: string };

type Props = {
  tee?: Spot | null;
  green?: Spot | null;
  shots?: MapShot[];
  me?: Spot | null;
  center?: Spot | null; // used when nothing else is on the map
  height?: number;
  editable?: boolean;
  onTee?: (s: Spot) => void;
  onGreen?: (s: Spot) => void;
  onTap?: (s: Spot) => void;
};

const TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

function pin(L: typeof Leaflet, text: string, bg: string, fg = "#fff") {
  return L.divIcon({
    className: "",
    html: `<div style="background:${bg};color:${fg};border:2px solid #fff;border-radius:999px;min-width:22px;height:22px;padding:0 5px;font:700 12px/18px Arial,sans-serif;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.5)">${text}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export default function HoleMap({ tee, green, shots = [], me, center, height = 320, editable, onTee, onGreen, onTap }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const lib = useRef<typeof Leaflet | null>(null);
  const handlers = useRef({ onTee, onGreen, onTap });
  handlers.current = { onTee, onGreen, onTap };
  const fitKey = useRef("");

  // Create the map once (Leaflet needs the browser).
  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !box.current || map.current) return;
      lib.current = L;
      const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView([34, -78.3], 16);
      L.tileLayer(TILES, { maxZoom: 21, maxNativeZoom: 19, attribution: "Imagery © Esri" }).addTo(m);
      m.on("click", (e: Leaflet.LeafletMouseEvent) => handlers.current.onTap?.([e.latlng.lat, e.latlng.lng]));
      layer.current = L.layerGroup().addTo(m);
      map.current = m;
      draw();
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => draw());

  function draw() {
    const L = lib.current;
    const m = map.current;
    const g = layer.current;
    if (!L || !m || !g) return;
    g.clearLayers();
    const points: Spot[] = [];
    const spot = (s: Spot) => L.latLng(s[0], s[1]);
    const toLL = (s: Leaflet.LatLng): Spot => [s.lat, s.lng];

    if (tee) {
      const t = L.marker(spot(tee), { icon: pin(L, "T", "#2563eb"), draggable: editable, title: "Tee" }).addTo(g);
      if (editable) t.on("dragend", () => handlers.current.onTee?.(toLL(t.getLatLng())));
      points.push(tee);
    }
    if (green) {
      const gr = L.marker(spot(green), { icon: pin(L, "⛳", "#16a34a"), draggable: editable, title: "Green" }).addTo(g);
      if (editable) gr.on("dragend", () => handlers.current.onGreen?.(toLL(gr.getLatLng())));
      points.push(green);
    }
    if (tee && green) L.polyline([spot(tee), spot(green)], { color: "#fff", weight: 1, dashArray: "4 6", opacity: 0.7 }).addTo(g);

    // Shots, joined in order per color (team).
    const byColor = new Map<string, Spot[]>();
    shots.forEach((s) => byColor.set(s.color, [...(byColor.get(s.color) ?? []), s.spot]));
    byColor.forEach((list, color) => {
      const line = green ? [...list, green] : list;
      if (line.length > 1) L.polyline(line.map(spot), { color, weight: 3, opacity: 0.9 }).addTo(g);
    });
    shots.forEach((s) => {
      L.marker(spot(s.spot), { icon: pin(L, s.label, s.color, s.color === "#ffffff" ? "#111" : "#fff") }).addTo(g);
      points.push(s.spot);
    });
    if (me) {
      L.circleMarker(spot(me), { radius: 7, color: "#fff", weight: 2, fillColor: "#ef4444", fillOpacity: 1 }).addTo(g);
    }

    // Re-fit only when the hole's pins change, so pinch-zooming isn't undone by every GPS update.
    const key = JSON.stringify([tee, green, shots.length ? 1 : 0, points.length ? null : (center ?? null)]);
    if (key !== fitKey.current) {
      fitKey.current = key;
      const all = points.length ? points : me ? [me] : center ? [center] : [];
      if (all.length === 1) m.setView(spot(all[0]), points.length ? 17 : 16); // a whole course: a bit wider
      else if (all.length > 1) m.fitBounds(L.latLngBounds(all.map(spot)), { padding: [28, 28], maxZoom: 19 });
    }
  }

  return <div ref={box} className={styles.holeMap} style={{ height }} />;
}
