import { test } from "node:test";
import assert from "node:assert/strict";
import { UpdateMedicationBody, touchesPrescription } from "@pillpal/shared";

test("changing only the dose does not erase avoid_foods", () => {
  assert.deepEqual(UpdateMedicationBody.parse({ strength: "75 mcg" }), { strength: "75 mcg" });
});

test("empty patch stays empty", () => {
  assert.deepEqual(UpdateMedicationBody.parse({}), {});
});

test("times must be 24-hour HH:MM and at least one", () => {
  assert.equal(UpdateMedicationBody.safeParse({ times: ["08:00", "18:30"] }).success, true);
  assert.equal(UpdateMedicationBody.safeParse({ times: ["8am"] }).success, false);
  assert.equal(UpdateMedicationBody.safeParse({ times: ["24:00"] }).success, false);
  assert.equal(UpdateMedicationBody.safeParse({ times: [] }).success, false);
});

test("food rule must be a known value; blank strength is rejected; pills_left cannot be negative", () => {
  assert.equal(UpdateMedicationBody.safeParse({ food_rule: "with_food" }).success, true);
  assert.equal(UpdateMedicationBody.safeParse({ food_rule: "sometimes" }).success, false);
  assert.equal(UpdateMedicationBody.safeParse({ strength: "  " }).success, false);
  assert.equal(UpdateMedicationBody.safeParse({ pills_left: -1 }).success, false);
});

test("prescription fields are doctor-only; refill info, pill count and photo are not", () => {
  for (const f of ["drug", "strength", "dose", "times", "food_rule", "avoid_foods", "active"]) {
    assert.equal(touchesPrescription({ [f]: f === "active" ? false : "x" }), true, f);
  }
  assert.equal(touchesPrescription({ pills_left: 5 }), false);
  assert.equal(touchesPrescription({ refill_info: "CVS", pill_photo_b64: "abc" }), false);
  assert.equal(touchesPrescription({}), false);
});
