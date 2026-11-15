/**
 * Renders every expression to a PNG contact sheet so Helen can be reviewed without a call, and benchmarks the
 * renderer (frame time incl. RGBA readback, memory).
 *   tsx scripts/avatar-sheet.ts out.png            portrait Helen (default) + mouth and blink strips
 *   tsx scripts/avatar-sheet.ts out.png vector     the stylised vector Helen
 */
import { writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { AvatarController } from "../src/avatar/controller.js";
import { PortraitRenderer, loadPortraitAssets } from "../src/avatar/portrait.js";
import { AvatarRenderer, H, W } from "../src/avatar/renderer.js";
import { NEUTRAL, PRESETS, type ExpressionName, type Rig } from "../src/avatar/rig.js";

const out = process.argv[2] ?? "avatar-sheet.png";
const style = process.argv[3] ?? "portrait";
const names = Object.keys(PRESETS) as ExpressionName[];
const mb = (b: number) => `${(b / 1e6).toFixed(0)} MB`;

const rss0 = process.memoryUsage().rss;
let clock = 0;
let draw: (r: Rig, e: ExpressionName) => Buffer;
let rgba: (r: Rig, e: ExpressionName) => Uint8Array;
let decoded = 0;
if (style === "vector") {
  const v = new AvatarRenderer();
  draw = (r) => (v.draw(r), v.png());
  rgba = (r) => (v.draw(r), v.rgba());
} else {
  const assets = await loadPortraitAssets();
  decoded = assets.bytes;
  const p = new PortraitRenderer(assets);
  // a change starts a crossfade: draw once to switch, then again a second later when it has finished
  draw = (r, e) => (p.draw(r, e, (clock += 1000)), p.draw(r, e, (clock += 1000)), p.png());
  rgba = (r, e) => (p.draw(r, e, (clock += 1000 / 15)), p.rgba());
}
const rssLoaded = process.memoryUsage().rss;

// Benchmark: 600 frames of a speaking call (15 fps), cycling expressions every 2 s and a blink now and then.
// Yields between frames like the live loop does (a tight loop never lets GC free the per-frame pixel copies).
const c = new AvatarController();
c.setState("speaking");
let t = 0;
c.setMouthLevel(() => Math.max(0, Math.sin(t * 9) * 0.5 + Math.sin(t * 23) * 0.4));
const times: number[] = [];
for (let i = 0; i < 600; i++) {
  t = i / 15;
  if (i % 30 === 0) c.show(names[(i / 30) % names.length]!, 2000);
  const rig = c.tick(1 / 15);
  const t0 = performance.now();
  const px = rgba(rig, c.expression);
  times.push(performance.now() - t0);
  // portrait's rgba() hands over the canvas's premultiplied pixels, which equal plain RGBA only when opaque
  if (i % 50 === 0) for (let j = 3; j < px.length; j += 4) if (px[j] !== 255) throw new Error(`frame ${i} not opaque`);
  await new Promise((r) => setImmediate(r));
}
times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
const p95 = times[Math.floor(times.length * 0.95)]!;
const max = times[times.length - 1]!;
const rssRun = process.memoryUsage().rss;
const bench = `${style}: frame avg ${avg.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${max.toFixed(2)} ms (target < 5 ms) · decoded ${mb(decoded)} · RSS ${mb(rss0)} → ${mb(rssLoaded)} loaded → ${mb(rssRun)} after 600 frames`;
console.log(bench);

// Sheet: presets (5 per row at half size), then mouth + blink strips at full size (portrait only).
const cols = 5;
const sc = 0.5;
const tw = W * sc;
const th = H * sc;
const presetRows = Math.ceil(names.length / cols);
const MOUTH = { x: 210, y: 205, w: 220, h: 135 };
const EYES = { x: 190, y: 140, w: 260, h: 90 };
const mouths: [string, Partial<Rig>][] = [
  ["closed", { mouthOpen: 0 }],
  ["slight", { mouthOpen: 0.3 }],
  ["ah", { mouthOpen: 1, mouthWide: 0 }],
  ["ee", { mouthOpen: 1, mouthWide: 0.6 }],
  ["oo", { mouthOpen: 1, mouthWide: -0.6 }],
];
const blinks: [string, Partial<Rig>][] = [
  ["open", { eyeOpen: 1 }],
  ["blink_half", { eyeOpen: 0.5 }],
  ["blink", { eyeOpen: 0 }],
];
const strips = style === "vector" ? 0 : 1;
const mouthW = (cols * tw - 3 * EYES.w) / mouths.length - 4;
const stripH = Math.max((mouthW / MOUTH.w) * MOUTH.h, EYES.h) + 6;
const footer = 28;
const sheet = createCanvas(cols * tw, presetRows * th + strips * stripH + footer);
const g = sheet.getContext("2d");
g.fillStyle = "#fff";
g.fillRect(0, 0, sheet.width, sheet.height);
const label = (s: string, x: number, y: number) => {
  g.font = "15px sans-serif";
  const w = g.measureText(s).width;
  g.fillStyle = "rgba(0,0,0,0.6)";
  g.fillRect(x, y - 17, w + 12, 22);
  g.fillStyle = "#fff";
  g.fillText(s, x + 6, y);
};

for (const [i, n] of names.entries()) {
  const img = await loadImage(draw({ ...PRESETS[n], breath: 0.5 }, n));
  const x = (i % cols) * tw;
  const y = Math.floor(i / cols) * th;
  g.drawImage(img, x, y, tw, th);
  label(n, x + 6, y + th - 8);
}

if (strips) {
  const y0 = presetRows * th + 4;
  let x = 0;
  for (const [n, o] of mouths) {
    const img = await loadImage(draw({ ...NEUTRAL, breath: 0.5, ...o }, "neutral"));
    const w = mouthW;
    const h = (w / MOUTH.w) * MOUTH.h;
    g.drawImage(img, MOUTH.x, MOUTH.y, MOUTH.w, MOUTH.h, x, y0, w, h);
    label(`mouth ${n}`, x + 4, y0 + h - 6);
    x += w + 4;
  }
  for (const [n, o] of blinks) {
    const img = await loadImage(draw({ ...NEUTRAL, breath: 0.5, ...o }, "neutral"));
    g.drawImage(img, EYES.x, EYES.y, EYES.w, EYES.h, x, y0, EYES.w - 4, EYES.h);
    label(n, x + 4, y0 + EYES.h - 6);
    x += EYES.w;
  }
}

g.fillStyle = "#222";
g.font = "13px monospace";
g.fillText(bench, 8, sheet.height - 9);
writeFileSync(out, sheet.toBuffer("image/png"));
console.log("wrote", out);
