import { test } from "node:test";
import assert from "node:assert/strict";
import { UpdatePatientBody } from "@pillpal/shared";

test("a partial update does not inject defaults (language must not be reset)", () => {
  assert.deepEqual(UpdatePatientBody.parse({ preferred_name: "Ro" }), { preferred_name: "Ro" });
});

test("an empty body stays empty so the route can reject it", () => {
  assert.deepEqual(UpdatePatientBody.parse({}), {});
});

test("phone numbers must be international (E.164)", () => {
  assert.equal(UpdatePatientBody.safeParse({ phone: "817-970-4356" }).success, false);
  assert.equal(UpdatePatientBody.safeParse({ phone: "+18179704356" }).success, true);
  assert.equal(UpdatePatientBody.safeParse({ caregiver_phone: "+12232467066" }).success, true);
});

test("optional text fields can be cleared with an empty string, required ones cannot", () => {
  assert.equal(UpdatePatientBody.safeParse({ caregiver_phone: "", doctor_name: "", address: "" }).success, true);
  assert.equal(UpdatePatientBody.safeParse({ name: "" }).success, false);
  assert.equal(UpdatePatientBody.safeParse({ phone: "" }).success, false);
});

test("values are trimmed and unknown fields are dropped", () => {
  assert.deepEqual(UpdatePatientBody.parse({ name: "  Rose Miller ", share_code: "ABC123" }), { name: "Rose Miller" });
});
