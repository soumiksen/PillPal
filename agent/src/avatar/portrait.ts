/**
 * Portrait Helen: draws the aligned expression frames (agent/assets/avatars/helen-frames/aligned, made by
 * scripts/align-helen-frames.py) into the 640x480 call frame. Per frame: the preset's portrait (crossfading
 * ~250 ms on a change), then feathered mouth and eye patches driven by the rig, all under a slight
 * breathing/tilt transform. Every image is decoded once; drawing does no I/O and allocates nothing large.
 * Only aligned PNGs (and helen.png as neutral) are read — never the source JPGs.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { PRESETS, type ExpressionName, type Rig } from "./rig.js";

export const W = 640;
export const H = 480;
const SRC = 768; // aligned frames are SRC x SRC, same geometry as helen.png

const ASSETS = fileURLToPath(new URL("../../assets/avatars/", import.meta.url));
const ALIGNED = `${ASSETS}helen-frames/aligned/`;

const EXPRESSIONS = Object.keys(PRESETS) as ExpressionName[];
/** Frames whose own mouth is closed: mouth and eye patches can be laid over them. */
const CALM = new Set<ExpressionName>(["neutral", "smile", "listening", "serious", "concerned", "goodbye"]);
/** Frames with an open mouth of their own: blink only. */
const BLINK_ONLY = new Set<ExpressionName>(["pleased", "surprised"]);

// Placement in the call frame: face centre (base 387,292) at (320,214); FaceTime crops the sides on a phone.
const SCALE = 0.72;
const FACE = { x: 387, y: 292 };
const AT = { x: 320, y: 214 };
const PIVOT = { x: 387, y: 560 }; // neck base, in base coords: tilt/nod rotate around here
const SIDE_FADE = 70; // px (base coords) faded to transparent at the portrait's left/right edges
const FADE_MS = 250;

interface Patch {
  img: Canvas;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PortraitAssets {
  frames: Map<ExpressionName, Canvas>;
  mouth: Map<string, Patch>; // closed, slight, ah, ee, oo
  eyes: Map<string, Patch>; // open, blink_half, blink
  backdrop: Canvas; // W x H, blurred wall behind the faded portrait edges
  bytes: number; // decoded pixel memory held
}

let cached: Promise<PortraitAssets> | null = null;

/** Decode every frame and patch once per process. Rejects if anything required is missing. */
export function loadPortraitAssets(): Promise<PortraitAssets> {
  cached ??= decodeAll().catch((err: unknown) => {
    cached = null;
    throw err;
  });
  return cached;
}

async function decodeAll(): Promise<PortraitAssets> {
  const load = async (path: string): Promise<Image> => loadImage(await readFile(path));
  const frames = new Map<ExpressionName, Canvas>();
  let bytes = 0;
  const fade = (img: Image): Canvas => {
    const cv = createCanvas(SRC, SRC);
    const g = cv.getContext("2d");
    g.drawImage(img, 0, 0, SRC, SRC);
    const grad = g.createLinearGradient(0, 0, SRC, 0);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(SIDE_FADE / SRC, "rgba(0,0,0,1)");
    grad.addColorStop(1 - SIDE_FADE / SRC, "rgba(0,0,0,1)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.globalCompositeOperation = "destination-in";
    g.fillStyle = grad;
    g.fillRect(0, 0, SRC, SRC);
    bytes += SRC * SRC * 4;
    return cv;
  };

  const imgs = await Promise.all(
    EXPRESSIONS.map((n) => load(n === "neutral" ? `${ASSETS}helen.png` : `${ALIGNED}${n}.png`)),
  );
  EXPRESSIONS.forEach((n, i) => {
    const img = imgs[i]!;
    if (img.width !== SRC || img.height !== SRC) throw new Error(`frame ${n} is ${img.width}x${img.height}, expected ${SRC}`);
    frames.set(n, fade(img));
  });

  const meta = JSON.parse(await readFile(`${ALIGNED}patches/patches.json`, "utf8")) as Record<
    string,
    { x: number; y: number; w: number; h: number }
  >;
  const mouth = new Map<string, Patch>();
  const eyes = new Map<string, Patch>();
  await Promise.all(
    Object.entries(meta).map(async ([key, m]) => {
      const img = await load(`${ALIGNED}patches/${key}.png`);
      const cv = createCanvas(m.w, m.h);
      cv.getContext("2d").drawImage(img, 0, 0, m.w, m.h);
      bytes += m.w * m.h * 4;
      const p = { img: cv, x: m.x, y: m.y, w: m.w, h: m.h };
      if (key.startsWith("mouth_")) mouth.set(key.slice(6), p);
      else if (key.startsWith("eyes_")) eyes.set(key.slice(5), p);
    }),
  );
  for (const k of ["slight", "ah", "ee", "oo"]) if (!mouth.has(k)) throw new Error(`mouth patch ${k} missing`);
  for (const k of ["blink_half", "blink"]) if (!eyes.has(k)) throw new Error(`eye patch ${k} missing`);

  // Backdrop: the neutral portrait enlarged and blurred, so the faded side edges melt into the wall.
  const backdrop = createCanvas(W, H);
  const b = backdrop.getContext("2d");
  b.fillStyle = "#c9cdb0"; // wall tone, so the frame is fully opaque even where the blur thins out
  b.fillRect(0, 0, W, H);
  b.filter = "blur(18px)";
  const s = SCALE * 1.25;
  b.drawImage(imgs[EXPRESSIONS.indexOf("neutral")]!, AT.x - FACE.x * s, AT.y - FACE.y * s, SRC * s, SRC * s);
  b.filter = "none";
  bytes += W * H * 4;

  return { frames, mouth, eyes, backdrop, bytes };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export class PortraitRenderer {
  private canvas = createCanvas(W, H);
  private g: SKRSContext2D = this.canvas.getContext("2d");
  private mouthBuf: Canvas;
  private eyeBuf: Canvas;
  private cur: ExpressionName = "neutral";
  private prev: ExpressionName | null = null;
  private fadeStart = 0;

  constructor(private readonly a: PortraitAssets) {
    const m = a.mouth.get("ah")!;
    const e = a.eyes.get("blink")!;
    this.mouthBuf = createCanvas(m.w, m.h);
    this.eyeBuf = createCanvas(e.w, e.h);
    this.g.imageSmoothingEnabled = true;
    this.g.imageSmoothingQuality = "low";
  }

  /** Draw one call frame. `now` (ms) only matters for crossfades; scripts pass it for determinism. */
  draw(r: Rig, expr: ExpressionName = "neutral", now = performance.now()): void {
    const g = this.g;
    if (expr !== this.cur) {
      // A change mid-fade restarts from whichever frame dominates the screen right now.
      const k = this.prev ? clamp01((now - this.fadeStart) / FADE_MS) : 1;
      this.prev = k < 0.5 && this.prev ? this.prev : this.cur;
      this.cur = expr;
      this.fadeStart = now;
    }
    let k = 1;
    if (this.prev) {
      k = clamp01((now - this.fadeStart) / FADE_MS);
      k = k * k * (3 - 2 * k);
      if (k >= 1) this.prev = null;
    }

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.drawImage(this.a.backdrop, 0, 0);

    // Whole-portrait motion: breathing, tilt and nod around the neck, a touch of lean-in.
    const sc = SCALE * (1 + r.lean * 0.035 + r.breath * 0.004);
    const ang = r.tilt * 0.026; // ~1.5 degrees at full tilt
    const dy = r.nod * 5 + r.breath * 1.2;
    const px = AT.x + (PIVOT.x - FACE.x) * SCALE;
    const py = AT.y + (PIVOT.y - FACE.y) * SCALE;
    g.translate(px, py + dy);
    g.rotate(ang);
    g.scale(sc, sc);
    g.translate(-PIVOT.x, -PIVOT.y);

    if (this.prev) g.drawImage(this.a.frames.get(this.prev)!, 0, 0);
    g.globalAlpha = k;
    g.drawImage(this.a.frames.get(this.cur)!, 0, 0);
    g.globalAlpha = 1;

    // How much each layer of patches is allowed, blended across an expression crossfade.
    const w = (set: Set<ExpressionName>) =>
      (set.has(this.cur) ? k : 0) + (this.prev && set.has(this.prev) ? 1 - k : 0);
    const mouthOk = w(CALM);
    const eyesOk = clamp01(mouthOk + w(BLINK_ONLY));

    if (eyesOk > 0) this.drawEyes(r, eyesOk);
    if (mouthOk > 0) this.drawMouth(r, mouthOk);
  }

  /** Mouth: the frame's own closed mouth -> slight -> ah, leaning to ee (wide) or oo (pursed). */
  private drawMouth(r: Rig, allowed: number) {
    const o = clamp01(r.mouthOpen);
    const presence = clamp01(o / 0.18) * allowed;
    if (presence <= 0.01) return;
    const u = clamp01((o - 0.3) / 0.7);
    const wide = Math.max(-1, Math.min(1, r.mouthWide / 0.6));
    const weights: [string, number][] = [
      ["slight", 1 - u],
      ["ah", u * (1 - Math.abs(wide))],
      ["ee", u * Math.max(0, wide)],
      ["oo", u * Math.max(0, -wide)],
    ];
    this.blendPatches(this.mouthBuf, this.a.mouth, weights, presence);
  }

  /** Eyes: only while closing (relative to the preset's own openness): blink_half -> blink. */
  private drawEyes(r: Rig, allowed: number) {
    const base = Math.max(0.05, PRESETS[this.cur].eyeOpen);
    const open = clamp01(r.eyeOpen / base);
    if (open >= 0.97) return;
    const presence = clamp01((1 - open) / 0.5) * allowed;
    const half = open >= 0.5 ? 1 : open / 0.5;
    this.blendPatches(this.eyeBuf, this.a.eyes, [["blink_half", half], ["blink", 1 - half]], presence);
  }

  /** Exact weighted mix of same-shaped patches (additive on premultiplied pixels), then one draw. */
  private blendPatches(buf: Canvas, set: Map<string, Patch>, weights: [string, number][], alpha: number) {
    const bg = buf.getContext("2d");
    bg.globalCompositeOperation = "source-over";
    bg.globalAlpha = 1;
    bg.clearRect(0, 0, buf.width, buf.height);
    bg.globalCompositeOperation = "lighter";
    let at: Patch | null = null;
    for (const [name, wt] of weights) {
      if (wt <= 0.003) continue;
      const p = set.get(name);
      if (!p) continue;
      at ??= p;
      bg.globalAlpha = wt;
      bg.drawImage(p.img, 0, 0);
    }
    if (!at) return;
    this.g.globalAlpha = alpha;
    this.g.drawImage(buf, at.x, at.y);
    this.g.globalAlpha = 1;
  }

  /** Raw RGBA (W*H*4). The frame is fully opaque, so the canvas's premultiplied pixels are plain RGBA. */
  rgba(): Uint8Array {
    const d = this.canvas.data();
    return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  }

  png(): Buffer {
    return this.canvas.toBuffer("image/png");
  }
}
