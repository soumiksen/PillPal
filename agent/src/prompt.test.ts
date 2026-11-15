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

test("emergency group call prompt tells Pal both people are on and not to diagnose", () => {
  const p = buildInstructions(ctx, { extraCaregiver: true });
  assert.match(p, /EMERGENCY FOLLOW-UP GROUP CALL/);
  assert.match(p, /never diagnose/);
  assert.match(p, /never place that call yourself/);
});

test("emergency rule gives Pal the exact hold sentence and tells her to escalate", () => {
  const p = buildInstructions(ctx);
  assert.match(p, /Keep your phone in your hand\. I am cutting this call and calling you along with your caregiver\./);
  assert.match(p, /call escalate_now/);
});

test("web calls: Pal says the caregiver is joining, escalates and stays in the call", () => {
  const p = buildInstructions(ctx, { transport: "web" });
  assert.match(p, /"Anna is joining us now\."/);
  assert.match(p, /requested_by "patient"/);
  assert.match(p, /Do not end the call/);
  assert.match(p, /two-sentence summary/);
  assert.doesNotMatch(p, /cutting this call/);
  assert.match(buildInstructions(ctx, { transport: "web", extraCaregiver: true }), /URGENT CALL/);
});
