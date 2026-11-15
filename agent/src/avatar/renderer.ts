/**
 * Draws Helen (stylised, flat Greek-vase palette) from a Rig. Pure drawing: no I/O, no patient data.
 * Static scenery is rendered once into an offscreen canvas; only the figure is redrawn per frame.
 */
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { Rig } from "./rig.js";

export const W = 640;
export const H = 480;

const C = {
  skyTop: "#cfe2ef", skyBot: "#f6e9cf", ground: "#e2b97a", stone: "#efe6d2", stoneShade: "#d8ccb1", stoneDark: "#bfb18f",
  meander: "#b5532c",
  skin: "#f0c9a4", skinShade: "#d9a77c", skinDeep: "#c98f66", blush: "rgba(214,110,100,",
  hair: "#3b2519", hairHi: "#5d3b27", hairLo: "#2a170f", silver: "#b9b2a8",
  gold: "#d4a73c", goldHi: "#f0d27a", goldDark: "#a97f1f",
  chiton: "#f8f2e4", chitonShade: "#e4d8bd", chitonDeep: "#cfc19f",
  cloak: "#1e4a7a", cloakShade: "#173a60", cloakHi: "#2a5c93",
  lip: "#b4544e", lipHi: "#d98a80", mouthIn: "#5e2a2a", white: "#fffaf0", iris: "#4a6a86", ink: "#2a1a12", amber: "#c2701f", turq: "#3aa6a0",
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* ---------- static scenery (drawn once) ---------- */

function column(g: SKRSContext2D, x: number, w: number) {
  const top = 70;
  const bottom = H;
  g.fillStyle = C.stone;
  g.fillRect(x, top, w, bottom - top);
  // shading on the right third
  g.fillStyle = C.stoneShade;
  g.fillRect(x + w * 0.68, top, w * 0.32, bottom - top);
  // flutes
  g.strokeStyle = C.stoneDark;
  g.lineWidth = 2;
  for (let i = 1; i < 5; i++) {
    const fx = x + (w * i) / 5;
    g.beginPath();
    g.moveTo(fx, top + 18);
    g.lineTo(fx, bottom);
    g.stroke();
  }
  // capital
  g.fillStyle = C.stone;
  g.fillRect(x - 8, top - 18, w + 16, 20);
  g.fillStyle = C.stoneShade;
  g.fillRect(x - 12, top - 32, w + 24, 14);
  g.strokeStyle = C.stoneDark;
  g.lineWidth = 2;
  g.strokeRect(x - 12, top - 32, w + 24, 14);
}

function scenery(): Canvas {
  const cv = createCanvas(W, H);
  const g = cv.getContext("2d");
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, C.skyTop);
  sky.addColorStop(0.55, C.skyBot);
  sky.addColorStop(1, C.ground);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  // distant hills and sea line
  g.fillStyle = "rgba(120,150,170,0.25)";
  g.beginPath();
  g.moveTo(0, 330);
  g.bezierCurveTo(120, 290, 220, 340, 330, 312);
  g.bezierCurveTo(440, 288, 540, 336, W, 300);
  g.lineTo(W, H);
  g.lineTo(0, H);
  g.fill();

  // olive branch top-left
  g.strokeStyle = "#6f7f4c";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(120, 20);
  g.quadraticCurveTo(170, 60, 230, 54);
  g.stroke();
  g.fillStyle = "#8a9a60";
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const px = lerp(130, 225, t);
    const py = lerp(26, 54, t) + (i % 2 ? 7 : -7);
    g.beginPath();
    g.ellipse(px, py, 11, 4, i % 2 ? 0.6 : -0.6, 0, Math.PI * 2);
    g.fill();
  }

  column(g, 26, 78);
  column(g, W - 104, 78);

  // meander bands
  g.strokeStyle = C.meander;
  g.lineWidth = 3;
  const s = 18;
  for (const y0 of [8, H - 28]) {
    g.beginPath();
    for (let x = 10; x < W - 10; x += s * 2) {
      g.moveTo(x, y0 + s);
      g.lineTo(x, y0);
      g.lineTo(x + s, y0);
      g.lineTo(x + s, y0 + s * 0.6);
      g.lineTo(x + s * 0.4, y0 + s * 0.6);
      g.lineTo(x + s * 0.4, y0 + s * 0.3);
      g.moveTo(x + s, y0 + s);
      g.lineTo(x + s * 2, y0 + s);
    }
    g.stroke();
  }
  return cv;
}

/* ---------- figure ---------- */

function fibula(g: SKRSContext2D, x: number, y: number, r = 12) {
  g.fillStyle = C.gold;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = C.goldDark;
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = C.goldHi;
  g.beginPath();
  g.arc(x - r * 0.25, y - r * 0.25, r * 0.4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = C.turq;
  g.beginPath();
  g.arc(x, y, r * 0.28, 0, Math.PI * 2);
  g.fill();
}

function garment(g: SKRSContext2D, breath: number) {
  const dy = breath * 3;
  g.save();
  g.translate(0, dy);

  // chiton (pleated linen)
  g.fillStyle = C.chiton;
  g.beginPath();
  g.moveTo(50, H);
  g.bezierCurveTo(90, 395, 205, 372, 280, 362);
  g.lineTo(360, 362);
  g.bezierCurveTo(435, 372, 550, 395, 590, H);
  g.closePath();
  g.fill();
  // fine vertical pleats
  g.strokeStyle = C.chitonShade;
  g.lineWidth = 2;
  for (let x = 120; x <= 520; x += 20) {
    const bend = (x - 320) * 0.1;
    g.beginPath();
    g.moveTo(x + bend * 0.2, 398 + Math.abs(x - 320) * 0.18);
    g.quadraticCurveTo(x + bend, 440, x + bend * 1.4, H);
    g.stroke();
  }
  g.strokeStyle = C.chitonDeep;
  g.lineWidth = 3;
  for (const x of [200, 290, 350, 440]) {
    g.beginPath();
    g.moveTo(x, 392);
    g.quadraticCurveTo(x + (x < 320 ? -14 : 14), 440, x + (x < 320 ? -26 : 26), H);
    g.stroke();
  }

  // himation (cloak) over the viewer's right shoulder, draped across the chest
  g.fillStyle = C.cloak;
  g.beginPath();
  g.moveTo(352, 364);
  g.bezierCurveTo(430, 372, 530, 392, 600, 430);
  g.lineTo(640, H);
  g.lineTo(255, H);
  g.bezierCurveTo(300, 440, 330, 405, 352, 364);
  g.closePath();
  g.fill();
  g.strokeStyle = C.cloakShade;
  g.lineWidth = 3;
  for (const [x1, y1, x2, y2] of [
    [420, 392, 380, H],
    [480, 404, 450, H],
    [545, 424, 530, H],
    [370, 380, 330, 470],
  ]) {
    g.beginPath();
    g.moveTo(x1, y1);
    g.quadraticCurveTo((x1 + x2) / 2 + 12, (y1 + y2) / 2, x2, y2);
    g.stroke();
  }
  g.strokeStyle = C.cloakHi;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(360, 368);
  g.bezierCurveTo(440, 376, 530, 396, 596, 432);
  g.stroke();
  // gold trim along the cloak edge
  g.strokeStyle = C.gold;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(255, H - 2);
  g.bezierCurveTo(300, 440, 332, 405, 354, 366);
  g.stroke();
  g.fillStyle = C.gold;
  for (let t = 0.1; t < 1; t += 0.14) {
    const px = lerp(255, 354, t);
    const py = lerp(H - 2, 366, t) - Math.sin(t * Math.PI) * 6;
    g.fillRect(px - 2, py - 2, 4, 4);
  }

  // neckline trim and fibula on the viewer's left shoulder
  g.strokeStyle = C.cloak;
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(262, 368);
  g.quadraticCurveTo(320, 424, 380, 368);
  g.stroke();
  fibula(g, 212, 394);
  // under-bust gold cord (zone)
  g.strokeStyle = C.gold;
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(96, 452);
  g.quadraticCurveTo(170, 442, 262, 458);
  g.stroke();
  g.strokeStyle = C.goldDark;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(96, 456);
  g.quadraticCurveTo(170, 446, 262, 462);
  g.stroke();

  g.restore();
}

function necklace(g: SKRSContext2D) {
  // gold beads along the neckline with an amber drop
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const x = lerp(274, 366, t);
    const y = 372 + Math.sin(t * Math.PI) * 30;
    g.fillStyle = i % 3 === 1 ? C.turq : C.gold;
    g.beginPath();
    g.arc(x, y, 3.6, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = C.amber;
  g.beginPath();
  g.ellipse(320, 416, 6.5, 9.5, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = C.goldDark;
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.beginPath();
  g.arc(318, 412, 2, 0, Math.PI * 2);
  g.fill();
}

function eye(g: SKRSContext2D, cx: number, cy: number, r: Rig, side: -1 | 1) {
  const open = Math.max(0, Math.min(1, r.eyeOpen));
  const w = 21;
  const up = 15 * open;
  const dn = 9 * open;
  // eyeshadow / lid fold
  g.strokeStyle = "rgba(160,110,90,0.5)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx - w - 1, cy - 4);
  g.quadraticCurveTo(cx, cy - 22 * Math.max(0.5, open) - 4, cx + w + 1, cy - 4);
  g.stroke();
  if (open < 0.12) {
    g.strokeStyle = C.ink;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx - w, cy);
    g.quadraticCurveTo(cx, cy + 4, cx + w, cy);
    g.stroke();
    // lashes on a closed lid
    g.lineWidth = 2;
    for (const k of [-0.7, -0.2, 0.3, 0.8]) {
      g.beginPath();
      g.moveTo(cx + k * w, cy + 2);
      g.lineTo(cx + k * w + side * 1.5, cy + 7);
      g.stroke();
    }
    return;
  }
  g.save();
  g.beginPath();
  g.moveTo(cx - w, cy);
  g.quadraticCurveTo(cx, cy - up * 2, cx + w, cy);
  g.quadraticCurveTo(cx, cy + dn * 2, cx - w, cy);
  g.closePath();
  g.clip();
  g.fillStyle = C.white;
  g.fillRect(cx - w, cy - 20, w * 2, 40);
  const ix = cx + r.gazeX * 7;
  const iy = cy + r.gazeY * 4;
  g.fillStyle = C.iris;
  g.beginPath();
  g.arc(ix, iy, 10.5, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#2f475c";
  g.lineWidth = 1.5;
  g.stroke();
  g.fillStyle = "#14171c";
  g.beginPath();
  g.arc(ix, iy, 5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.92)";
  g.beginPath();
  g.arc(ix - 3.5, iy - 3.5, 2.4, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // upper lid line + lashes flicking outward
  g.strokeStyle = C.ink;
  g.lineWidth = 3.4;
  g.beginPath();
  g.moveTo(cx - w, cy);
  g.quadraticCurveTo(cx, cy - up * 2, cx + w, cy);
  g.stroke();
  g.lineWidth = 2.4;
  const outer = side === -1 ? -1 : 1;
  for (const [t, len] of [[0.9, 7], [0.78, 6], [0.62, 5]] as const) {
    const px = cx + outer * w * t;
    const py = cy - up * 2 * 0.5 * (1 - t) - 1;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px + outer * len * 0.8, py - len * 0.7);
    g.stroke();
  }
  // lower lid
  g.lineWidth = 1.6;
  g.strokeStyle = C.skinShade;
  g.beginPath();
  g.moveTo(cx - w + 3, cy + dn * 1.1);
  g.quadraticCurveTo(cx, cy + dn * 1.9, cx + w - 3, cy + dn * 1.1);
  g.stroke();
}

function brow(g: SKRSContext2D, cx: number, cy: number, r: Rig, side: -1 | 1) {
  const lift = -r.browRaise * 12;
  const inner = -r.browWorry * 13; // inner end rises
  const xi = cx + (side === -1 ? 24 : -24);
  const xo = cx + (side === -1 ? -27 : 27);
  const y = cy - 35 + lift;
  // tapered brow: thick at the inner end, thin at the outer end
  g.fillStyle = C.hair;
  g.beginPath();
  g.moveTo(xo, y + 4);
  g.quadraticCurveTo(cx, y - 9, xi, y + inner - 2);
  g.lineTo(xi, y + inner + 5);
  g.quadraticCurveTo(cx, y - 2, xo, y + 5);
  g.closePath();
  g.fill();
}

function mouth(g: SKRSContext2D, cx: number, cy: number, r: Rig) {
  const w = 24 + r.mouthWide * 8 + r.smile * 4;
  const corner = -r.smile * 9;
  const open = Math.max(0, r.mouthOpen) * 24;
  const xl = cx - w;
  const xr = cx + w;
  const yc = cy + corner;
  if (open > 1.5) {
    g.fillStyle = C.mouthIn;
    g.beginPath();
    g.moveTo(xl, yc);
    g.quadraticCurveTo(cx, cy - 7, xr, yc);
    g.quadraticCurveTo(cx, cy + 12 + open * 1.6, xl, yc);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(255,250,240,0.92)";
    g.beginPath();
    g.moveTo(xl + 6, yc + 1);
    g.quadraticCurveTo(cx, cy - 5, xr - 6, yc + 1);
    g.quadraticCurveTo(cx, cy - 1 + open * 0.15, xl + 6, yc + 1);
    g.closePath();
    g.fill();
    // tongue hint
    g.fillStyle = "#c46a68";
    g.beginPath();
    g.ellipse(cx, cy + 6 + open * 0.9, w * 0.32, 3 + open * 0.18, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.lineCap = "round";
  g.lineJoin = "round";
  // upper lip
  g.strokeStyle = C.lip;
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(xl, yc);
  g.quadraticCurveTo(cx - 8, cy - 7 - r.smile * 2, cx, cy - 4);
  g.quadraticCurveTo(cx + 8, cy - 7 - r.smile * 2, xr, yc);
  g.stroke();
  // lower lip (fuller) with highlight
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(xl + 4, yc + 1);
  g.quadraticCurveTo(cx, cy + 10 + open * 1.5 + Math.max(0, r.smile) * 3, xr - 4, yc + 1);
  g.stroke();
  g.strokeStyle = C.lipHi;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx - 8, cy + 6 + open * 1.2);
  g.quadraticCurveTo(cx, cy + 8 + open * 1.3, cx + 8, cy + 6 + open * 1.2);
  g.stroke();
  // smile lines
  const sm = Math.max(0, r.smile);
  if (sm > 0.35) {
    g.strokeStyle = "rgba(190,130,100,0.55)";
    g.lineWidth = 2;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + sx * (w + 7), yc - 4);
      g.quadraticCurveTo(cx + sx * (w + 12), yc + 4, cx + sx * (w + 7), yc + 11);
      g.stroke();
    }
  }
}

function earring(g: SKRSContext2D, x: number, y: number) {
  g.strokeStyle = C.goldDark;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y + 10);
  g.stroke();
  g.fillStyle = C.gold;
  g.beginPath();
  g.ellipse(x, y + 17, 5, 8, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = C.goldDark;
  g.stroke();
  g.fillStyle = C.goldHi;
  g.beginPath();
  g.arc(x - 1.5, y + 14, 1.8, 0, Math.PI * 2);
  g.fill();
}

function curl(g: SKRSContext2D, x: number, y: number, rr: number, dir: 1 | -1) {
  // a ringlet: a rounded lock with a highlight, falling beside the face
  g.fillStyle = C.hair;
  g.beginPath();
  g.ellipse(x, y, rr * 0.85, rr * 1.25, dir * 0.25, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = C.hairHi;
  g.lineWidth = 2.5;
  g.lineCap = "round";
  g.beginPath();
  g.arc(x - dir * 1, y, rr * 0.5, dir === 1 ? Math.PI * 0.2 : Math.PI * 0.8, dir === 1 ? Math.PI * 1.6 : Math.PI * 1.8 + Math.PI * 0.1, false);
  g.stroke();
}

export class AvatarRenderer {
  private canvas = createCanvas(W, H);
  private g = this.canvas.getContext("2d");
  private bg = scenery();

  draw(r: Rig): void {
    const g = this.g;
    g.clearRect(0, 0, W, H);
    g.drawImage(this.bg, 0, 0);
    garment(g, r.breath);

    // head group: tilt, nod and lean around the neck base
    g.save();
    g.translate(320, 360);
    g.rotate(r.tilt * 0.07);
    const sc = 1.1 + r.lean * 0.05;
    g.scale(sc, sc);
    g.translate(-320, -360 + r.nod * 8 + r.breath * 2);

    // back hair: crown with a bun, braided
    g.fillStyle = C.hair;
    g.beginPath();
    g.ellipse(320, 218, 150, 176, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(320, 74, 46, 32, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = C.hairHi;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(320, 74, 26, 0.5, Math.PI * 1.7);
    g.arc(320, 74, 13, 0.5, Math.PI * 1.7);
    g.stroke();
    // strand highlights across the crown
    g.strokeStyle = C.hairHi;
    g.lineWidth = 2;
    for (const [x1, y1, x2, y2] of [
      [200, 160, 232, 96],
      [250, 128, 280, 80],
      [440, 160, 408, 96],
      [390, 128, 360, 80],
    ]) {
      g.beginPath();
      g.moveTo(x1, y1);
      g.quadraticCurveTo((x1 + x2) / 2 - 10, (y1 + y2) / 2 - 10, x2, y2);
      g.stroke();
    }
    // braid hanging on the viewer's right
    for (let i = 0; i < 6; i++) {
      g.fillStyle = i % 2 ? C.hairHi : C.hair;
      g.beginPath();
      g.ellipse(452 + i * 2, 280 + i * 23, 18, 14, 0.35, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = C.gold;
    g.beginPath();
    g.arc(462, 424, 6, 0, Math.PI * 2);
    g.fill();

    // neck with shadow under the chin (over the back hair so it stays visible)
    g.fillStyle = C.skinShade;
    g.beginPath();
    g.roundRect(282, 312, 76, 78, 14);
    g.fill();
    g.fillStyle = C.skinDeep;
    g.beginPath();
    g.ellipse(320, 340, 46, 20, 0, 0, Math.PI);
    g.fill();

    // ears + earrings (hidden partly by hair)
    g.fillStyle = C.skinShade;
    g.beginPath();
    g.ellipse(215, 250, 12, 20, 0, 0, Math.PI * 2);
    g.ellipse(425, 250, 12, 20, 0, 0, Math.PI * 2);
    g.fill();
    earring(g, 214, 266);
    earring(g, 426, 266);

    // face
    g.fillStyle = C.skin;
    g.beginPath();
    g.ellipse(320, 228, 106, 133, 0, 0, Math.PI * 2);
    g.fill();
    necklace(g);
    // jaw / cheekbone shading
    g.save();
    g.beginPath();
    g.ellipse(320, 228, 106, 133, 0, 0, Math.PI * 2);
    g.clip();
    const jg = g.createLinearGradient(0, 262, 0, 362);
    jg.addColorStop(0, "rgba(201,143,102,0)");
    jg.addColorStop(1, "rgba(201,143,102,0.34)");
    g.fillStyle = jg;
    g.fillRect(200, 262, 240, 110);
    g.restore();
    g.fillStyle = "rgba(255,240,220,0.22)";
    g.beginPath();
    g.ellipse(262, 252, 26, 11, -0.25, 0, Math.PI * 2);
    g.ellipse(378, 252, 26, 11, 0.25, 0, Math.PI * 2);
    g.fill();
    // cheeks
    const bl = Math.max(0, r.smile) * 0.8 + 0.2;
    g.fillStyle = `${C.blush}${(0.16 + bl * 0.26).toFixed(2)})`;
    g.beginPath();
    g.ellipse(252, 274, 24, 15, 0, 0, Math.PI * 2);
    g.ellipse(388, 274, 24, 15, 0, 0, Math.PI * 2);
    g.fill();
    // soft age lines at the eyes
    g.strokeStyle = "rgba(190,135,105,0.4)";
    g.lineWidth = 1.5;
    for (const [x, s] of [[238, -1], [402, 1]] as const) {
      for (const k of [0, 6]) {
        g.beginPath();
        g.moveTo(x + s * 2, 228 + k);
        g.lineTo(x + s * 11, 232 + k + 3);
        g.stroke();
      }
    }

    // fringe (centre-parted) with a silver streak at the temples
    g.fillStyle = C.hair;
    g.beginPath();
    g.moveTo(206, 220);
    g.bezierCurveTo(198, 118, 268, 86, 320, 90);
    g.bezierCurveTo(372, 86, 442, 118, 434, 220);
    g.bezierCurveTo(420, 190, 392, 160, 340, 148);
    g.lineTo(320, 152);
    g.lineTo(300, 148);
    g.bezierCurveTo(248, 160, 220, 190, 206, 220);
    g.closePath();
    g.fill();
    g.strokeStyle = C.silver;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(216, 196);
    g.bezierCurveTo(226, 170, 246, 154, 272, 146);
    g.moveTo(424, 196);
    g.bezierCurveTo(414, 170, 394, 154, 368, 146);
    g.stroke();
    g.strokeStyle = C.hairHi;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(320, 92);
    g.lineTo(320, 150);
    g.stroke();
    // ringlets framing the face
    curl(g, 206, 262, 13, -1);
    curl(g, 200, 296, 12, -1);
    curl(g, 434, 262, 13, 1);
    curl(g, 440, 296, 12, 1);

    // stephane: embossed gold diadem with a jewel
    g.strokeStyle = C.goldDark;
    g.lineWidth = 14;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(213, 180);
    g.quadraticCurveTo(320, 114, 427, 180);
    g.stroke();
    g.strokeStyle = C.gold;
    g.lineWidth = 11;
    g.beginPath();
    g.moveTo(213, 180);
    g.quadraticCurveTo(320, 114, 427, 180);
    g.stroke();
    g.strokeStyle = C.goldHi;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(218, 176);
    g.quadraticCurveTo(320, 111, 422, 176);
    g.stroke();
    g.fillStyle = C.goldDark;
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const x = lerp(222, 418, t);
      const y = 178 - Math.sin(t * Math.PI) * 52 + (Math.abs(t - 0.5) < 0.05 ? 0 : 0);
      g.beginPath();
      g.arc(x, y + 1.5, 1.8, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = C.turq;
    g.beginPath();
    g.moveTo(320, 118);
    g.lineTo(329, 132);
    g.lineTo(320, 146);
    g.lineTo(311, 132);
    g.closePath();
    g.fill();
    g.strokeStyle = C.goldDark;
    g.lineWidth = 2;
    g.stroke();

    // features
    eye(g, 277, 222, r, -1);
    eye(g, 363, 222, r, 1);
    brow(g, 277, 222, r, -1);
    brow(g, 363, 222, r, 1);
    // nose with shading
    g.strokeStyle = C.skinShade;
    g.lineWidth = 3;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(322, 238);
    g.quadraticCurveTo(312, 268, 304, 282);
    g.quadraticCurveTo(318, 290, 334, 282);
    g.stroke();
    g.fillStyle = "rgba(201,143,102,0.28)";
    g.beginPath();
    g.ellipse(322, 284, 14, 4, 0, 0, Math.PI * 2);
    g.fill();
    mouth(g, 320, lerp(322, 318, r.smile > 0 ? r.smile : 0), r);
    // chin shadow
    g.fillStyle = "rgba(201,143,102,0.22)";
    g.beginPath();
    g.ellipse(320, 350, 20, 6, 0, 0, Math.PI * 2);
    g.fill();

    g.restore();
  }

  /** Raw RGBA (W*H*4). */
  rgba(): Uint8Array {
    const d = this.g.getImageData(0, 0, W, H).data;
    return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  }

  png(): Buffer {
    return this.canvas.toBuffer("image/png");
  }
}
