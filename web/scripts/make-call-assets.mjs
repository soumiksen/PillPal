// Generates the phone apps' icons, caller photo and ringtone into public/call/.
// Run from web/: node scripts/make-call-assets.mjs  (uses sharp from the workspace).
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const out = "public/call";
const helen = "../agent/assets/avatars/helen.png";

// Helen's face, square crop (source is 768x768).
const face = () => sharp(helen).extract({ left: 174, top: 96, width: 420, height: 420 });
for (const size of [180, 192, 512]) {
  await face().resize(size, size).png().toFile(`${out}/pal-${size}.png`);
}
await face().resize(480, 480).jpeg({ quality: 82 }).toFile(`${out}/pal-photo.jpg`);

// Caregiver app: white heart on a warm rose square (iOS rounds the corners itself).
const heart = (size, bg = "#E11D48") => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="${bg}"/>
  <path d="M50 82 C20 62 12 46 12 34 C12 22 22 14 32 14 C40 14 46 18 50 25 C54 18 60 14 68 14 C78 14 88 22 88 34 C88 46 80 62 50 82 Z" fill="#fff"/>
</svg>`);
for (const size of [180, 192, 512]) {
  await sharp(heart(size)).png().toFile(`${out}/care-${size}.png`);
}

// Ringtone: a soft three-note chime twice, then silence (2.4 s, loops). 16-bit mono 22.05 kHz.
const rate = 22050;
const total = Math.round(rate * 2.4);
const pcm = new Int16Array(total);
const notes = [
  [0.0, 659.25], [0.18, 783.99], [0.36, 1046.5],
  [0.8, 659.25], [0.98, 783.99], [1.16, 1046.5],
];
for (const [start, f] of notes) {
  const s0 = Math.round(start * rate);
  const len = Math.round(0.55 * rate);
  for (let i = 0; i < len && s0 + i < total; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.008) * Math.exp(-t * 6);
    const v = env * (Math.sin(2 * Math.PI * f * t) * 0.7 + Math.sin(2 * Math.PI * f * 2 * t) * 0.18 + Math.sin(2 * Math.PI * f * 3 * t) * 0.06);
    pcm[s0 + i] = Math.max(-32767, Math.min(32767, pcm[s0 + i] + v * 0.55 * 32767));
  }
}
const data = Buffer.from(pcm.buffer);
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);
writeFileSync(`${out}/ringtone.wav`, Buffer.concat([header, data]));
console.log("call assets written to", out);
