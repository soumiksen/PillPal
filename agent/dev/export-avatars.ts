/** Export a self-contained, offline HTML preview. No accounts or local server required. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { AVATARS, portraitPath } from "../src/avatars/catalog.js";
import { createAvatarPreviewPage } from "./avatars.js";

const portraits = Object.fromEntries(await Promise.all(AVATARS.map(async avatar => [
  avatar.id, `data:image/png;base64,${(await readFile(portraitPath(avatar))).toString("base64")}`,
])));
const output = resolve(process.argv[2] ?? `${tmpdir()}/PillPal_Avatar_Preview.html`);
await writeFile(output, createAvatarPreviewPage(portraits));
console.log(`Offline avatar preview → ${output}`);
