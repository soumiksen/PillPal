import { Hono, type Context } from "hono";
import * as ai from "@pillpal/ai";
import {
  CreateMedicationBody,
  UpdateMedicationBody,
  type IdResponse,
} from "@pillpal/shared";
import type { z } from "zod";
import { db } from "../db.js";
import { getMedication, getPatient, must, mustOne, notFound } from "../lib/data.js";
import { jsonBody, uuidParam, validate } from "../lib/http.js";
import { uploadPillPhoto } from "../lib/storage.js";
import { fileToUpload, isMultipart, multipartBody } from "../lib/upload.js";
import { assertCareTeam, requireUser } from "../lib/auth.js";

export const medications = new Hono();

const ARRAY_FIELDS = new Set(["times", "avoid_foods"]);
const NUMBER_FIELDS = new Set(["pills_left"]);
const BOOL_FIELDS = new Set(["active"]);

/**
 * Accept JSON, or multipart with the same fields + a "pill_photo" file.
 * Multipart arrays may be a JSON array string or comma-separated.
 */
async function readMedication<S extends z.ZodType>(c: Context, schema: S) {
  if (!isMultipart(c)) {
    return { body: await jsonBody(c, schema), photo: undefined as Photo | undefined };
  }

  const form = await multipartBody(c);
  const fields: Record<string, unknown> = {};
  let photo: Photo | undefined;
  for (const [k, v] of Object.entries(form)) {
    if (v instanceof File) {
      if (k === "pill_photo" && v.size > 0) photo = await fileToUpload(v);
      continue;
    }
    if (ARRAY_FIELDS.has(k)) {
      const s = v.trim();
      fields[k] = s.startsWith("[") ? safeJson(s) : s ? s.split(",").map((x) => x.trim()) : [];
    } else if (NUMBER_FIELDS.has(k)) fields[k] = v === "" ? undefined : Number(v);
    else if (BOOL_FIELDS.has(k)) fields[k] = v === "true";
    else fields[k] = v;
  }
  return { body: validate(schema, fields), photo };
}

type Photo = { b64: string; mime?: string };

/** Store the reference photo (public bucket) and describe it with ai.describePill. */
async function processPhoto(patientId: string, photo: Photo) {
  const [reference_photo_url, pill_description] = await Promise.all([
    uploadPillPhoto(patientId, photo.b64, photo.mime),
    ai.describePill(photo.b64.replace(/^data:[^,]*,/, "")),
  ]);
  return { reference_photo_url, pill_description };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Web: confirmed Rx fields (+ optional pill photo → Storage + ai.describePill). */
medications.post("/", requireUser, async (c) => {
  const { body, photo } = await readMedication(c, CreateMedicationBody);
  const { pill_photo_b64, ...fields } = body;
  await getPatient(fields.patient_id);
  await assertCareTeam(c, fields.patient_id);
  const p = photo ?? (pill_photo_b64 ? { b64: pill_photo_b64 } : undefined);
  const extra = p ? await processPhoto(fields.patient_id, p) : {};
  const row = mustOne(
    "insert medication",
    await db.from("medications").insert({ ...fields, ...extra }).select("id").single(),
  );
  return c.json({ id: row.id } satisfies IdResponse, 201);
});

medications.patch("/:id", requireUser, async (c) => {
  const id = uuidParam(c, "id");
  const med = await getMedication(id);
  if (!med.patient_id) throw notFound("medication");
  await assertCareTeam(c, med.patient_id);
  const { body, photo } = await readMedication(c, UpdateMedicationBody);
  const { pill_photo_b64, ...fields } = body;
  const p = photo ?? (pill_photo_b64 ? { b64: pill_photo_b64 } : undefined);
  const extra = p && med.patient_id ? await processPhoto(med.patient_id, p) : {};
  const patch = { ...fields, ...extra };
  if (Object.keys(patch).length > 0) {
    must("update medication", await db.from("medications").update(patch).eq("id", id));
  }
  return c.json({ id } satisfies IdResponse);
});
