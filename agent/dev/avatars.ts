/** Credential-free art review: npm run avatars:preview -w @pillpal/agent */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { AVATARS, findAvatar, portraitPath } from "../src/avatars/catalog.js";
import { avatarSvg } from "../src/avatars/illustration.js";

export function createAvatarPreviewPage(portraits = Object.fromEntries(AVATARS.map(a => [a.id, `/portrait/${a.id}.png`]))): string {
return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PillPal · Odyssey companions</title><style>
*{box-sizing:border-box}body{margin:0;background:#f7f5ed;color:#244d46;font:16px system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:44px 30px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d9dfd2;padding-bottom:24px}.brand{font-size:23px;font-weight:750}.tag{font-size:11px;letter-spacing:2px;color:#738178}h1{font:500 clamp(32px,4vw,53px) Georgia,serif;letter-spacing:-1px;max-width:650px;margin:36px 0 16px}p{line-height:1.7;color:#65776e}section{display:grid;grid-template-columns:1fr 390px;gap:56px;align-items:center}.cast{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:25px 0}button,select{font:inherit;color:inherit;border:1px solid #cbd3c4;border-radius:12px;background:#fffdf8;padding:12px;cursor:pointer}button:hover,button[aria-pressed=true]{border-color:#346e70;box-shadow:0 0 0 2px #346e7022}button img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;border-radius:8px;margin-bottom:9px}.controls{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}.stage{position:relative;background:#e7eadc;border-radius:38px;overflow:hidden;box-shadow:0 20px 65px #244d461c;aspect-ratio:368/560}.stage svg,.stage>img{display:block;width:100%;height:100%;object-fit:cover}.status{display:flex;align-items:center;gap:8px;font-size:13px;margin-top:16px}.dot{background:#8ba98c;border-radius:50%;width:8px;height:8px}small{display:block;font-size:12px;line-height:1.7;color:#7c887e;margin-top:20px}footer{margin-top:44px;padding-top:20px;border-top:1px solid #d9dfd2;font-size:12px;color:#7c887e}@media(max-width:800px){section{grid-template-columns:1fr;gap:24px}.stage{max-width:368px;margin:auto}main{padding:25px 18px}.cast{gap:5px}button{padding:6px;font-size:12px}}@media(prefers-reduced-motion:reduce){.stage{scroll-behavior:auto}}
</style><main><header><span class="brand">PillPal<span style="color:#96a988"> ✦</span></span><span class="tag">THE ODYSSEY COLLECTION</span></header>
<section><div><h1>A familiar face.<br>A little mythology.</h1><p>Meet Pal’s four original companions. Choose a face, explore the live illustration, or preview the portrait prepared for a hosted talking avatar.</p>
<div class="cast">${AVATARS.map(a => `<button data-id="${a.id}" aria-pressed="${a.id === "helen"}"><img src="${portraits[a.id]}" alt="${a.name}, original stylized portrait">${a.name}</button>`).join("")}</div>
<div class="controls"><select id="mode" aria-label="Preview mode"><option value="illustrated">Animated 2D</option><option value="portrait">3D-style portrait</option></select><select id="state" aria-label="Agent state"><option>listening</option><option>speaking</option><option>thinking</option></select><button id="shuffle">Shuffle cast ↻</button><button id="pause" aria-pressed="false">Pause motion</button></div>
<small>The 2D mouth follows speaking state; it is not phoneme lip sync.<br>The portrait view is still artwork. Hosted animation needs LemonSlice access.<br>Each patient keeps a stable companion by default; shuffle is a demo control.</small></div>
<div><div class="stage" id="stage">${avatarSvg(AVATARS[0], 0)}</div><div class="status"><span class="dot"></span><span id="label">Helen · listening</span></div></div></section>
<footer>Original Homer-inspired characters · Faces change; Pal’s care instructions stay the same.</footer></main>
<script>
const cast=${JSON.stringify(AVATARS)};
const portraits=${JSON.stringify(portraits)};
const AVATAR_WIDTH=368,AVATAR_HEIGHT=560;
// tsx may preserve function names with this helper; the renderer is otherwise standalone.
const __name=(fn)=>fn;
const render=${avatarSvg.toString()};
let selected=cast[0],paused=matchMedia('(prefers-reduced-motion: reduce)').matches,elapsed=0,last=performance.now();
const stage=document.getElementById('stage'),mode=document.getElementById('mode'),state=document.getElementById('state'),pause=document.getElementById('pause');
function draw(){stage.innerHTML=mode.value==='portrait'?'<img alt="'+selected.name+' portrait (still image)" src="'+portraits[selected.id]+'">':render(selected,elapsed,state.value);document.getElementById('label').textContent=selected.name+' · '+(mode.value==='portrait'?'portrait preview':state.value)}
function choose(id){selected=cast.find(a=>a.id===id);document.querySelectorAll('[data-id]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.id===id));draw()}
document.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>choose(b.dataset.id));
document.getElementById('shuffle').onclick=()=>{const others=cast.filter(a=>a.id!==selected.id);choose(others[Math.floor(Math.random()*others.length)].id)};
mode.onchange=draw;state.onchange=draw;
function updatePause(){pause.setAttribute('aria-pressed',paused);pause.textContent=paused?'Resume motion':'Pause motion'}
pause.onclick=()=>{paused=!paused;updatePause()};updatePause();
function frame(now){if(!paused)elapsed+=(now-last)/1000;last=now;if(!paused&&mode.value==='illustrated')draw();requestAnimationFrame(frame)}requestAnimationFrame(frame);
</script></html>`;
}

export function createAvatarPreviewServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
    if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(createAvatarPreviewPage()); return; }
    const id = /^\/portrait\/([a-z]+)\.png$/.exec(url.pathname)?.[1];
    const avatar = findAvatar(id);
    if (!avatar) { res.writeHead(404); res.end(); return; }
    try {
      const bytes = await readFile(portraitPath(avatar));
      res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=3600" }); res.end(bytes);
    } catch { res.writeHead(500); res.end("Portrait unavailable"); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.AVATAR_PREVIEW_PORT ?? 8790);
  createAvatarPreviewServer().listen(port, "127.0.0.1", () => console.log(`Odyssey avatar gallery → http://localhost:${port}`));
}
