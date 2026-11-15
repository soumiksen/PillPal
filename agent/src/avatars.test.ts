import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { AVATARS, avatarProvider, findAvatar, portraitPath, selectAvatar } from "./avatars/catalog.js";
import { avatarSvg, AVATAR_WIDTH, AVATAR_HEIGHT } from "./avatars/illustration.js";

test("patient selection stays familiar across calls, with explicit demo overrides", () => {
  for (let i = 0; i < 100; i++) {
    assert.equal(selectAvatar(`patient-${i}`).id, selectAvatar(`patient-${i}`).id);
  }
  assert.equal(selectAvatar("rose", "cyclops", "helen").id, "cyclops");
  assert.equal(selectAvatar("rose", "../../secret", "helen").id, "helen");
  assert.equal(selectAvatar("rose", undefined, "random", () => 0).id, "helen");
  assert.equal(selectAvatar("rose", undefined, "random", () => .9999).id, "cyclops");
  assert.throws(() => selectAvatar("rose", undefined, "random", () => 1));
  assert.throws(() => selectAvatar("rose", undefined, "unknown"));
  assert.equal(findAvatar("<script>"), undefined);
});

test("provider selection is explicit and reversible", () => {
  assert.equal(avatarProvider(), "illustrated");
  assert.equal(avatarProvider("off"), "off");
  assert.equal(avatarProvider("lemonslice"), "lemonslice");
  assert.throws(() => avatarProvider("typo"));
});

test("all portraits exist, and every rig rasterizes at the video track dimensions", async () => {
  for (const avatar of AVATARS) {
    const portrait = await sharp(portraitPath(avatar)).metadata();
    assert.ok(portrait.width && portrait.width >= AVATAR_WIDTH);
    for (const [t, state] of [[0, "listening"], [4.525, "thinking"], [8, "speaking"]] as const) {
      const svg = avatarSvg(avatar, t, state);
      assert.ok(!svg.includes("NaN"));
      const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.equal(info.width, AVATAR_WIDTH);
      assert.equal(info.height, AVATAR_HEIGHT);
      assert.equal(data.length, AVATAR_WIDTH * AVATAR_HEIGHT * 4);
    }
    assert.notEqual(avatarSvg(avatar, 0, "listening"), avatarSvg(avatar, 0, "speaking"));
    assert.equal(avatarSvg(avatar, NaN), avatarSvg(avatar, 0));
    assert.equal(avatarSvg(avatar, 2), avatarSvg(avatar, 2));
  }
});
