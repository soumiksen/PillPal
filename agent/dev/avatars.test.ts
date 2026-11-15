import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import type { AddressInfo } from "node:net";
import { createAvatarPreviewServer } from "./avatars.js";

test("gallery serves allowlisted artwork and all preview controls execute", async () => {
  const server = createAvatarPreviewServer();
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const html = await (await fetch(base)).text();
    const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!;
    const elements = new Map<string, any>();
    for (const id of ["stage", "mode", "state", "pause", "label", "shuffle"]) {
      elements.set(id, { value: id === "mode" ? "illustrated" : "speaking", innerHTML: "", textContent: "", setAttribute() {} });
    }
    const buttons = ["helen", "odysseus", "agamemnon", "cyclops"].map(id => ({ dataset: { id }, onclick: () => {}, setAttribute() {} }));
    let animation: (t: number) => void = () => {};
    vm.runInNewContext(script, {
      performance: { now: () => 0 }, Math,
      matchMedia: () => ({ matches: false }),
      document: { getElementById: (id: string) => elements.get(id), querySelectorAll: () => buttons },
      requestAnimationFrame: (callback: typeof animation) => { animation = callback; },
    });
    animation(100);
    assert.match(elements.get("stage").innerHTML, /<svg/);
    buttons[3]!.onclick();
    assert.match(elements.get("label").textContent, /Cyclops/);
    elements.get("mode").value = "portrait";
    elements.get("mode").onchange();
    assert.match(elements.get("stage").innerHTML, /\/portrait\/cyclops.png/);
    elements.get("shuffle").onclick();
    assert.doesNotMatch(elements.get("label").textContent, /Cyclops/);
    elements.get("pause").onclick();
    assert.equal(elements.get("pause").textContent, "Resume motion");
    const portrait = await fetch(base + "/portrait/helen.png");
    assert.equal(portrait.status, 200);
    assert.equal(portrait.headers.get("content-type"), "image/png");
    assert.ok((await portrait.arrayBuffer()).byteLength > 10000);
    assert.equal((await fetch(base + "/portrait/unknown.png")).status, 404);
    assert.equal((await fetch(base + "/", { method: "POST" })).status, 405);
  } finally { await new Promise<void>((r, reject) => server.close(e => e ? reject(e) : r())); }
});
