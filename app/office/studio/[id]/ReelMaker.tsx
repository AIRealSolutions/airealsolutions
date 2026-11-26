"use client";

// Reels assembled from templates, in the browser: a canvas is drawn frame by frame from the brand kit and
// the draft, recorded with MediaRecorder (MP4 in Chrome and Safari, WebM elsewhere), then saved to the Library.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../../office.module.css";
import { officeInsert, officePatch, officeRest } from "../../lib/client";
import { libraryLinks, uploadToLibrary, type Asset, type BrandKit, type Content } from "../types";

type Template = "cards" | "photos" | "clip";
export type ReelSpec = {
  template?: Template; shape?: "vertical" | "wide" | "square"; seconds?: number; lines?: string[]; end?: string;
  photo_ids?: string[]; clip_id?: string | null; music_id?: string | null; music_volume?: number; colors?: string[]; captions?: boolean;
};
type Seg = { kind: "title" | "card" | "photo" | "clip" | "end"; text: string; start: number; dur: number; img?: ImageBitmap };

const TEMPLATES: [Template, string, string][] = [
  ["cards", "Text cards", "Hook, one card per beat, then your call to action. No footage needed."],
  ["photos", "Photo slideshow", "Your photos with a slow zoom and a caption on each."],
  ["clip", "Video + captions", "One clip from the Library with captions burned in and an end card."],
];
const SHAPES = { vertical: [1080, 1920], wide: [1920, 1080], square: [1080, 1080] } as const;
const MIME = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
const pickMime = () => (typeof MediaRecorder === "undefined" ? "" : MIME.find((m) => MediaRecorder.isTypeSupported(m)) || "");

async function bitmap(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Could not load a photo from the Library.");
  return createImageBitmap(await r.blob());
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${w}` : w;
      if (ctx.measureText(next).width > maxW && line) { out.push(line); line = w; } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}

export default function ReelMaker({ content, assets, links, kit, businessName, onSaved }: {
  content: Content & { reel?: ReelSpec }; assets: Asset[]; links: Record<string, string>; kit: BrandKit | null; businessName: string; onSaved: (msg: string) => Promise<void>;
}) {
  const d = content.draft;
  const initial: ReelSpec = useMemo(() => ({
    template: "cards", shape: content.format === "youtube" ? "wide" : "vertical", seconds: 3, captions: true, music_volume: 0.35,
    lines: [d.hook || content.title, ...(d.beats || [])].filter(Boolean).slice(0, 12),
    end: d.cta || "", photo_ids: content.asset_ids.filter((id) => assets.find((a) => a.id === id && a.kind === "image")), clip_id: null, music_id: null,
    colors: kit?.colors?.length ? kit.colors : ["#1D4ED8", "#0F172A"],
    ...(content.reel || {}),
  }), [content, assets, kit, d]);
  const [spec, setSpec] = useState<ReelSpec>(initial);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [cover, setCover] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stop = useRef<() => void>(() => undefined);
  const set = (p: Partial<ReelSpec>) => setSpec((s) => ({ ...s, ...p }));
  const [w, h] = SHAPES[spec.shape || "vertical"];
  const images = assets.filter((a) => a.kind === "image" || a.kind === "logo");
  const videos = assets.filter((a) => a.kind === "video");
  const audio = assets.filter((a) => a.kind === "audio");
  const mime = useMemo(pickMime, []);
  useEffect(() => () => stop.current(), []);

  /** Everything the renderer needs: segments with times, the logo, and (for clip) the video element. */
  const prepare = useCallback(async () => {
    const per = Math.min(Math.max(spec.seconds || 3, 1.5), 8);
    const lines = (spec.lines || []).map((l) => l.trim()).filter(Boolean);
    const ids = [kit?.logo_asset_id, ...(spec.template === "photos" ? spec.photo_ids || [] : []), spec.template === "clip" ? spec.clip_id : null].filter(Boolean) as string[];
    const paths = ids.map((id) => assets.find((a) => a.id === id)?.storage_path).filter(Boolean) as string[];
    const links = await libraryLinks(paths);
    const urlOf = (id?: string | null) => { const a = assets.find((x) => x.id === id); return a ? links[a.storage_path] : undefined; };
    const logoUrl = urlOf(kit?.logo_asset_id);
    const logo = logoUrl ? await bitmap(logoUrl).catch(() => undefined) : undefined;
    const segs: Seg[] = [];
    let t = 0;
    let video: HTMLVideoElement | undefined;
    if (spec.template === "clip") {
      const u = urlOf(spec.clip_id);
      if (!u) throw new Error("Pick a video clip from the Library.");
      const blob = await (await fetch(u)).blob();
      video = document.createElement("video");
      video.src = URL.createObjectURL(blob);
      video.playsInline = true;
      video.preload = "auto";
      await new Promise<void>((ok, bad) => { video!.onloadedmetadata = () => ok(); video!.onerror = () => bad(new Error("That video could not be read by the browser.")); });
      const dur = Math.min(video.duration || 15, 170);
      segs.push({ kind: "clip", text: "", start: 0, dur });
      t = dur;
    } else if (spec.template === "photos") {
      const photos = (spec.photo_ids || []).map((id) => urlOf(id)).filter(Boolean) as string[];
      if (!photos.length) throw new Error("Pick at least one photo.");
      const bitmaps = await Promise.all(photos.map(bitmap));
      const n = Math.max(bitmaps.length, lines.length ? Math.min(lines.length, bitmaps.length * 2) : 0);
      for (let i = 0; i < n; i++) { segs.push({ kind: "photo", text: lines[i] || "", img: bitmaps[i % bitmaps.length], start: t, dur: per }); t += per; }
    } else {
      if (!lines.length) throw new Error("Add at least one line of text.");
      lines.forEach((l, i) => { segs.push({ kind: i === 0 ? "title" : "card", text: l, start: t, dur: i === 0 ? per + 0.5 : per }); t += i === 0 ? per + 0.5 : per; });
    }
    segs.push({ kind: "end", text: spec.end || "", start: t, dur: 3 });
    t += 3;
    // Captions for the clip template: the script's sentences, spread evenly over the clip.
    const script = (d.script || lines.join(". ")).replace(/\[[^\]]*\]/g, "").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
    return { segs, total: t, logo, video, script };
  }, [spec, kit, assets, d.script]);

  type Prepared = Awaited<ReturnType<typeof prepare>>;

  const draw = useCallback((ctx: CanvasRenderingContext2D, p: Prepared, time: number) => {
    const [c1, c2] = [spec.colors?.[0] || "#1D4ED8", spec.colors?.[1] || spec.colors?.[0] || "#0F172A"];
    const unit = Math.min(w, h) / 1080;
    const g = ctx.createLinearGradient(0, 0, w * 0.4, h);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const seg = p.segs.find((s) => time >= s.start && time < s.start + s.dur) || p.segs[p.segs.length - 1];
    const local = time - seg.start;
    const fade = Math.min(1, local / 0.35, Math.max(0, (seg.dur - local) / 0.3));

    const text = (str: string, y: number, size: number, opts: { weight?: number; alpha?: number; box?: boolean; maxW?: number } = {}) => {
      ctx.font = `${opts.weight || 800} ${size * unit}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const lines = wrap(ctx, str, opts.maxW || w * 0.82);
      const lh = size * unit * 1.18;
      const top = y - ((lines.length - 1) * lh) / 2;
      ctx.globalAlpha = opts.alpha ?? 1;
      if (opts.box && lines.length) {
        const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 48 * unit;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath(); ctx.roundRect(w / 2 - bw / 2, top - lh / 2 - 12 * unit, bw, lh * lines.length + 24 * unit, 18 * unit); ctx.fill();
      }
      ctx.fillStyle = "#fff"; ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 12 * unit;
      lines.forEach((l, i) => ctx.fillText(l, w / 2, top + i * lh));
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    };
    const logo = (size: number, y: number, alpha = 1) => {
      if (!p.logo) return;
      const s = (size * unit) / Math.max(p.logo.width, p.logo.height);
      ctx.globalAlpha = alpha;
      ctx.drawImage(p.logo, w / 2 - (p.logo.width * s) / 2, y - (p.logo.height * s) / 2, p.logo.width * s, p.logo.height * s);
      ctx.globalAlpha = 1;
    };
    const cover = (img: CanvasImageSource & { width: number; height: number }, zoom: number) => {
      const iw = (img as HTMLVideoElement).videoWidth || img.width, ih = (img as HTMLVideoElement).videoHeight || img.height;
      const s = Math.max(w / iw, h / ih) * zoom;
      ctx.drawImage(img, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
    };

    if (seg.kind === "title" || seg.kind === "card") {
      logo(140, h * 0.12, 0.9);
      const slide = (1 - Math.min(1, local / 0.45)) * 40 * unit;
      text(seg.text, h * 0.47 + slide, seg.kind === "title" ? 96 : 78, { alpha: fade });
      // progress dots
      const cards = p.segs.filter((s) => s.kind === "title" || s.kind === "card");
      const i = cards.indexOf(seg);
      cards.forEach((_, k) => { ctx.globalAlpha = k === i ? 1 : 0.4; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(w / 2 + (k - (cards.length - 1) / 2) * 30 * unit, h * 0.78, 7 * unit, 0, Math.PI * 2); ctx.fill(); });
      ctx.globalAlpha = 1;
    } else if (seg.kind === "photo" && seg.img) {
      cover(seg.img, 1 + 0.1 * (local / seg.dur));
      const shade = ctx.createLinearGradient(0, h * 0.5, 0, h);
      shade.addColorStop(0, "rgba(0,0,0,0)"); shade.addColorStop(1, "rgba(0,0,0,0.6)");
      ctx.fillStyle = shade; ctx.fillRect(0, h * 0.5, w, h * 0.5);
      if (seg.text) text(seg.text, h * 0.72, 64, { alpha: fade, box: true });
      logo(110, h * 0.08, 0.85);
      // fade from black between photos
      if (local < 0.25) { ctx.fillStyle = `rgba(0,0,0,${1 - local / 0.25})`; ctx.fillRect(0, 0, w, h); }
    } else if (seg.kind === "clip" && p.video) {
      cover(p.video, 1);
      if (spec.captions !== false && p.script.length) {
        const i = Math.min(p.script.length - 1, Math.floor((local / seg.dur) * p.script.length));
        text(p.script[i], h * 0.72, 58, { box: true });
      }
      logo(100, h * 0.07, 0.8);
    } else {
      logo(260, h * 0.32);
      text(seg.text || businessName, h * (p.logo ? 0.55 : 0.45), 72, { alpha: fade });
      if (p.logo || seg.text) text(businessName, h * 0.66, 40, { weight: 600, alpha: fade * 0.9 });
      if (kit?.disclaimers) text(kit.disclaimers, h * 0.9, 24, { weight: 500, alpha: 0.85, maxW: w * 0.86 });
    }
  }, [spec.colors, spec.captions, w, h, kit, businessName]);

  async function preview() {
    stop.current();
    setError(""); setBusy("preview");
    try {
      const p = await prepare();
      const ctx = canvas.current!.getContext("2d")!;
      const t0 = performance.now();
      let raf = 0;
      if (p.video) { p.video.muted = true; p.video.currentTime = 0; void p.video.play(); }
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        draw(ctx, p, Math.min(t, p.total - 0.01));
        setProgress(t / p.total);
        if (t < p.total) raf = requestAnimationFrame(tick); else { setBusy(""); p.video?.pause(); }
      };
      stop.current = () => { cancelAnimationFrame(raf); p.video?.pause(); setBusy(""); };
      tick();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not preview."); setBusy(""); }
  }

  async function record() {
    stop.current();
    if (!mime) return setError("This browser cannot record video. Use Chrome, Edge or Safari.");
    setError(""); setBusy("record"); setProgress(0);
    let audioCtx: AudioContext | null = null;
    try {
      const p = await prepare();
      const el = canvas.current!;
      const ctx = el.getContext("2d")!;
      draw(ctx, p, 0);
      const stream = el.captureStream(30);
      audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      if (p.video) { p.video.muted = false; audioCtx.createMediaElementSource(p.video).connect(dest); }
      let music: AudioBufferSourceNode | null = null;
      const track = assets.find((a) => a.id === spec.music_id);
      if (track) {
        const u = (await libraryLinks([track.storage_path]))[track.storage_path];
        const buf = await audioCtx.decodeAudioData(await (await fetch(u)).arrayBuffer());
        music = audioCtx.createBufferSource(); music.buffer = buf; music.loop = true;
        const gain = audioCtx.createGain(); gain.gain.value = Math.min(Math.max(spec.music_volume ?? 0.35, 0), 1);
        // fade out over the last 1.5 seconds
        gain.gain.setValueAtTime(gain.gain.value, audioCtx.currentTime + Math.max(0, p.total - 1.5));
        gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + p.total);
        music.connect(gain).connect(dest);
      }
      const tracks = [...stream.getVideoTracks(), ...(p.video || music ? dest.stream.getAudioTracks() : [])];
      const bitrate = Math.min(8_000_000, Math.floor((44 * 1024 * 1024 * 8) / p.total));
      const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 128_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const finished = new Promise<void>((ok) => { rec.onstop = () => ok(); });
      const shot: { blob: Blob | null; asked: boolean } = { blob: null, asked: false };
      rec.start(1000);
      music?.start();
      if (p.video) { p.video.currentTime = 0; await p.video.play(); }
      const t0 = performance.now();
      await new Promise<void>((done) => {
        let raf = 0;
        const tick = () => {
          const t = (performance.now() - t0) / 1000;
          draw(ctx, p, Math.min(t, p.total - 0.01));
          setProgress(t / p.total);
          if (cover && !shot.asked && t > 1.2) { shot.asked = true; el.toBlob((b) => { shot.blob = b; }, "image/jpeg", 0.9); }
          if (t >= p.total) { done(); return; }
          raf = requestAnimationFrame(tick);
        };
        stop.current = () => { cancelAnimationFrame(raf); done(); };
        tick();
      });
      p.video?.pause(); music?.stop();
      rec.stop();
      await finished;
      setBusy("save");
      const ext = mime.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(chunks, { type: mime.split(";")[0] });
      if (blob.size > 50 * 1024 * 1024) throw new Error("The video came out over 50 MB. Use fewer cards or a shorter clip.");
      const base = content.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "reel";
      const file = new File([blob], `${base}.${ext}`, { type: blob.type });
      const path = await uploadToLibrary(file, content.business_id);
      const video = await officeInsert<Asset>("office_assets", { business_id: content.business_id, storage_path: path, file_name: file.name, mime: file.type, size_bytes: file.size, kind: "video", tags: ["reel", spec.template || "cards"], caption: content.title.slice(0, 200) });
      const ids = [video.id];
      if (shot.blob?.size) {
        const cf = new File([shot.blob], `${base}-cover.jpg`, { type: "image/jpeg" });
        const cp = await uploadToLibrary(cf, content.business_id);
        const ca = await officeInsert<Asset>("office_assets", { business_id: content.business_id, storage_path: cp, file_name: cf.name, mime: "image/jpeg", size_bytes: cf.size, kind: "image", tags: ["cover"], caption: content.title.slice(0, 200) });
        ids.push(ca.id);
      }
      // The new video goes first, so it is what gets posted; older reels stay attached after it.
      const fresh = (await officeRest<{ asset_ids: string[] }[]>(`office_content?id=eq.${content.id}&select=asset_ids&limit=1`))[0]?.asset_ids || [];
      await officePatch("office_content", `id=eq.${content.id}`, { asset_ids: [...ids, ...fresh.filter((x) => !ids.includes(x))] });
      await officePatch("office_content", `id=eq.${content.id}`, { reel: spec }).catch(() => undefined); // remembered once phase 7 is run
      await onSaved(`Saved ${file.name} (${(file.size / 1048576).toFixed(1)} MB) to the Library and attached it${ids.length > 1 ? ", with a cover photo" : ""}.${ext === "webm" ? " This browser saved WebM: YouTube and Facebook take it, Instagram does not. Record in Chrome or Safari for MP4." : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recording failed.");
    } finally {
      void audioCtx?.close();
      setBusy("");
    }
  }

  const lines = spec.lines || [];
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <div><h2>Make the video</h2><small className={styles.muted}>Built from your brand kit and this draft. Recording plays in real time; keep this tab in front.</small></div>
      </div>
      {error && <div className={styles.alert} role="alert">{error}</div>}
      <div className={styles.reelLayout}>
        <div className={styles.stack}>
          <fieldset className={styles.templatePick}>
            <legend>Template</legend>
            {TEMPLATES.map(([k, l, about]) => (
              <label key={k} className={spec.template === k ? styles.templateOn : undefined}>
                <input type="radio" name="tpl" checked={spec.template === k} onChange={() => set({ template: k })} />
                <strong>{l}</strong><small className={styles.muted}>{about}</small>
              </label>
            ))}
          </fieldset>
          <div className={styles.formGrid}>
            <label className={styles.field}>Shape
              <select value={spec.shape} onChange={(e) => set({ shape: e.target.value as ReelSpec["shape"] })}>
                <option value="vertical">Vertical 9:16 (Reels, Shorts)</option><option value="wide">Wide 16:9 (YouTube)</option><option value="square">Square 1:1 (feed)</option>
              </select>
            </label>
            {spec.template !== "clip" && <label className={styles.field}>Seconds per card<input type="number" min={1.5} max={8} step={0.5} value={spec.seconds} onChange={(e) => set({ seconds: Number(e.target.value) })} /></label>}
            {spec.template === "clip" && (
              <label className={styles.field}>Clip
                <select value={spec.clip_id || ""} onChange={(e) => set({ clip_id: e.target.value || null })}>
                  <option value="">Choose a video…</option>{videos.map((v) => <option key={v.id} value={v.id}>{v.file_name}</option>)}
                </select>
              </label>
            )}
            {spec.template === "clip" && <label className={styles.checkLine}><input type="checkbox" checked={spec.captions !== false} onChange={(e) => set({ captions: e.target.checked })} />Burn in captions from the script</label>}
            <label className={styles.field}>Music
              <select value={spec.music_id || ""} onChange={(e) => set({ music_id: e.target.value || null })}>
                <option value="">{audio.length ? "None" : "None (upload audio to the Library)"}</option>{audio.map((a) => <option key={a.id} value={a.id}>{a.file_name}</option>)}
              </select>
            </label>
            {spec.music_id && <label className={styles.field}>Music volume<input type="range" min={0} max={1} step={0.05} value={spec.music_volume ?? 0.35} onChange={(e) => set({ music_volume: Number(e.target.value) })} /></label>}
            <label className={styles.field}>Colors
              <span className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
                {[0, 1].map((i) => <input key={i} type="color" className={styles.colorSwatch} value={spec.colors?.[i] || (i ? "#0F172A" : "#1D4ED8")} aria-label={`Color ${i + 1}`} onChange={(e) => { const c = [...(spec.colors || [])]; c[i] = e.target.value; set({ colors: c }); }} />)}
              </span>
            </label>
          </div>
          {spec.template === "photos" && (
            <div>
              <small className={styles.muted}>Photos, in order (tap to add or remove)</small>
              <div className={styles.thumbGrid}>
                {images.slice(0, 30).map((a) => {
                  const i = (spec.photo_ids || []).indexOf(a.id);
                  return (
                    <button key={a.id} type="button" className={`${styles.thumb} ${i >= 0 ? styles.thumbOn : ""}`} onClick={() => set({ photo_ids: i >= 0 ? (spec.photo_ids || []).filter((x) => x !== a.id) : [...(spec.photo_ids || []), a.id] })}>
                      {links[a.storage_path] && <img src={links[a.storage_path]} alt="" />}
                      <span className={styles.thumbName}>{i >= 0 ? `${i + 1}. ` : ""}{a.file_name}</span>
                    </button>
                  );
                })}
                {!images.length && <p className={styles.muted}>No photos in the Library for this business yet.</p>}
              </div>
            </div>
          )}
          {spec.template !== "clip" && (
            <label className={styles.field}>
              <span className={styles.taskMeta}>{spec.template === "photos" ? "Caption for each photo" : "Cards"}<small className={styles.muted} style={{ fontWeight: 400 }}>one per line · from the hook and beats</small></span>
              <textarea rows={6} value={lines.join("\n")} onChange={(e) => set({ lines: e.target.value.split("\n") })} />
            </label>
          )}
          <label className={styles.field}>End card<input value={spec.end || ""} onChange={(e) => set({ end: e.target.value })} placeholder={`e.g. ${businessName} — link in bio`} /></label>
          <label className={styles.checkLine}><input type="checkbox" checked={cover} onChange={(e) => setCover(e.target.checked)} />Also save a JPEG cover (Instagram and Facebook can use it)</label>
          <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
            <button type="button" className="button button-secondary" disabled={busy === "record" || busy === "save"} onClick={() => (busy === "preview" ? stop.current() : void preview())}>{busy === "preview" ? "Stop" : "Preview"}</button>
            <button type="button" className="button button-primary" disabled={!!busy && busy !== "preview"} onClick={() => void record()}>{busy === "record" ? `Recording… ${Math.round(progress * 100)}%` : busy === "save" ? "Saving…" : "Record and save"}</button>
            {busy === "record" && <button type="button" className={styles.linkButton} onClick={() => stop.current()}>Stop early</button>}
          </div>
          {!mime && <small className={styles.muted}>This browser can&apos;t record video. Chrome, Edge and Safari can.</small>}
        </div>
        <div className={styles.reelPreview} style={{ aspectRatio: `${w} / ${h}` }}>
          <canvas ref={canvas} width={w} height={h} aria-label="Video preview" />
          {(busy === "preview" || busy === "record") && <progress value={progress} max={1} />}
        </div>
      </div>
    </article>
  );
}
