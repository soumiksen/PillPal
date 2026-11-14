import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPlate, tts, translate } from "./index.js";

// No API keys in CI → stubs; the contract shapes must hold.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GOOGLE_API_KEY;

test("stub translate/tts keep signatures", async () => {
  assert.equal(await translate("hi", "en"), "hi");
  const wav = await tts("hola", "es");
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
});

test("stub plate check is never ok on empty-stomach rule", async () => {
  const r = await checkPlate("AAAA", { food_rule: "empty_stomach", drug: "X", avoid_foods: [] } as never);
  assert.equal(r.verdict, "wait");
});
