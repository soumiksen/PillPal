import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInstructions } from "./prompt.js";
import type { PatientContext } from "@pillpal/shared";

const ctx = {
  patient: { id: "p", preferred_name: "Rose", name: "Rose Smith", language: "es", caregiver_name: "Anna" },
  meds: [],
  due_now: [{ medication_id: "m1", drug: "Metformin", dose: "1 tablet", scheduled_at: "x", food_rule: "with_food" }],
  memories: [{ fact: "Granddaughter visits Sundays" }],
  last_checkins: [],
} as unknown as PatientContext;

test("prompt carries name, language, due meds, safety rules", () => {
  const p = buildInstructions(ctx);
  assert.match(p, /Pal, PillPal's warm companion for Rose/);
  assert.match(p, /Speak Spanish/);
  assert.match(p, /Metformin 1 tablet \(take with food\)/);
  assert.match(p, /never change or add a dose/);
  assert.match(p, /Anna/);
});
