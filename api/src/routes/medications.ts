import { Hono, type Context } from "hono";
import * as ai from "@pillpal/ai";
import {
  CreateMedicationBody,
  UpdateMedicationBody,
  type IdResponse,
} from "@pillpal/shared";
import type { z } from "zod";
import { jsonBody, uuidParam, validate } from "../lib/http.js";
import { newId } from "../lib/stubs.js";
import { fileToUpload, isMultipart, multipartBody } from "../lib/upload.js";

export const medications = new Hono();

const ARRAY_FIELDS = new Set(["times", "avoid_foods"]);
const NUMBER_FIELDS = new Set(["pills_left"]);
const BOOL_FIELDS = new Set(["active"]);

/**
 * Accept JSON, or multipart with the same fields + a "pill_photo" file.
 * Multipart arrays may be a JSON array string or comma-separated.
 */
async function readMedication<S extends z.ZodType>(c: Context, schema: S) {
  if (!isMultipart(c)) return { body: await jsonBody(c, schema), photoB64: undefined };

  const form = await multipartBody(c);
  const fields: Record<string, unknown> = {};
  let photoB64: string | undefined;
  for (const [k, v] of Object.entries(form)) {
    if (v instanceof File) {
      if (k === "pill_photo" && v.size > 0) photoB64 = (await fileToUpload(v)).b64;
      continue;
    }
    if (ARRAY_FIELDS.has(k)) {
      const s = v.trim();
      fields[k] = s.startsWith("[") ? safeJson(s) : s ? s.split(",").map((x) => x.trim()) : [];
    } else if (NUMBER_FIELDS.has(k)) fields[k] = v === "" ? undefined : Number(v);
    else if (BOOL_FIELDS.has(k)) fields[k] = v === "true";
    else fields[k] = v;
  }
  return { body: validate(schema, fields), photoB64 };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Web: confirmed Rx fields (+ optional pill photo → ai.describePill). */
medications.post("/", async (c) => {
  const { body, photoB64 } = await readMedication(c, CreateMedicationBody);
  const b64 = photoB64 ?? body.pill_photo_b64;
  if (b64) await ai.describePill(b64); // stub: description would be stored with the row
  return c.json({ id: newId() } satisfies IdResponse, 201);
});

medications.patch("/:id", async (c) => {
  const id = uuidParam(c, "id");
  const { body, photoB64 } = await readMedication(c, UpdateMedicationBody);
  const b64 = photoB64 ?? body.pill_photo_b64;
  if (b64) await ai.describePill(b64);
  return c.json({ id } satisfies IdResponse);
});
