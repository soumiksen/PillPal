/**
 * Live smoke test for @pillpal/ai. Needs ANTHROPIC_API_KEY (Claude) and/or GOOGLE_API_KEY (Gemini) in ../../.env.
 *   npm run smoke -w @pillpal/ai -- text
 *   npm run smoke -w @pillpal/ai -- rx label.jpg
 *   npm run smoke -w @pillpal/ai -- pill pill.jpg [pill-description]
 *   npm run smoke -w @pillpal/ai -- plate food.jpg [empty_stomach|with_food|none]
 *   npm run smoke -w @pillpal/ai -- tts "Hola Rose" es      (writes out.wav)
 *   npm run smoke -w @pillpal/ai -- stt memo.wav
 * Prints results (your own test data); nothing is stored.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { checkPill, checkPlate, classifyMessage, describePill, doseChangeMessage, extractCheckIn, hasClaude, hasGemini, parseRx, transcribe, translate, tts } from "../src/index.js";
import type { MedicationRow, PatientRow } from "@pillpal/shared";

const [cmd, a, b] = process.argv.slice(2);
const b64 = (p: string) => readFileSync(p).toString("base64");
const now = new Date().toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const med = (n: number, drug: string, food: MedicationRow["food_rule"], look: string): MedicationRow => ({
  id: id(n), patient_id: id(1), drug, strength: "", dose: "1 tablet", times: ["08:00"], food_rule: food, avoid_foods: ["grapefruit"],
  pills_left: 10, refill_info: null, pill_description: look, reference_photo_url: null, active: true, confirmed_by: "t", created_at: now,
});
const show = (label: string, v: unknown) => console.log(`\n== ${label}\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`);
console.log(`claude=${hasClaude()} gemini=${hasGemini()}`);

switch (cmd) {
  case "text": {
    show("classify ES red flag", await classifyMessage("Me duele el pecho y estoy muy mareada"));
    show("classify EN taken", await classifyMessage("I took my pill"));
    show("translate es", await translate("Time for your Metformin 💊\n\nTap ❤ once you've taken it.", "es"));
    const patient = { id: id(1), name: "Rose", preferred_name: "Rose", language: "es", doctor_name: "Patel" } as PatientRow;
    show("dose change", await doseChangeMessage(patient, { drug: "Metformin", old_dose: "500 mg", new_dose: "250 mg", doctor_note: "Take it with dinner." }));
    show("check-in", await extractCheckIn("Pal: Good morning Rose!\nRose: Buenos días. Me mareé un poco al levantarme.\nPal: Please show me the pill.", [{ at: now, kind: "pill", verdict: "mismatch", what_i_see: "white oblong tablet" }], [med(2, "Metformin", "with_food", "white oblong")]));
    break;
  }
  case "rx": show("parseRx", await parseRx(b64(a!), "image/jpeg")); break;
  case "pill": {
    const meds = [med(2, "Metformin", "with_food", "white oblong tablet"), med(3, "Levothyroxine", "empty_stomach", b ?? "small round pale-orange tablet")];
    show("describePill", await describePill(b64(a!)));
    show("checkPill (due = Levothyroxine)", await checkPill(b64(a!), meds, id(3)));
    break;
  }
  case "plate": show("checkPlate", await checkPlate(b64(a!), med(3, "Levothyroxine", (b as MedicationRow["food_rule"]) ?? "empty_stomach", ""))); break;
  case "tts": writeFileSync("out.wav", await tts(a ?? "Hola Rose", b ?? "es")); console.log("wrote out.wav — play with: afplay out.wav"); break;
  case "stt": show("transcribe", await transcribe(readFileSync(a!))); break;
  default: console.log("usage: text | rx <img> | pill <img> [desc] | plate <img> [rule] | tts <text> <lang> | stt <wav>");
}
