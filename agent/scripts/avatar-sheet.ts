/** Renders every expression to a PNG contact sheet so Helen can be reviewed without a call: tsx scripts/avatar-sheet.ts out.png */
import { writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { AvatarRenderer, H, W } from "../src/avatar/renderer.js";
import { PRESETS, type ExpressionName } from "../src/avatar/rig.js";

const out = process.argv[2] ?? "avatar-sheet.png";
const names = Object.keys(PRESETS) as ExpressionName[];
const cols = 5;
const sc = 0.5;
const sheet = createCanvas(cols * W * sc, Math.ceil(names.length / cols) * H * sc);
const g = sheet.getContext("2d");
const r = new AvatarRenderer();
for (const [i, n] of names.entries()) {
  r.draw({ ...PRESETS[n], mouthOpen: n === "surprised" ? 0.25 : n === "pleased" ? 0 : PRESETS[n].mouthOpen });
  const img = await loadImage(r.png());
  g.drawImage(img, (i % cols) * W * sc, Math.floor(i / cols) * H * sc, W * sc, H * sc);
  g.fillStyle = "#000";
  g.font = "16px sans-serif";
  g.fillText(n, (i % cols) * W * sc + 8, Math.floor(i / cols) * H * sc + H * sc - 8);
}
writeFileSync(out, sheet.toBuffer("image/png"));
console.log("wrote", out);
