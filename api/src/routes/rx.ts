import { Hono } from "hono";
import * as ai from "@pillpal/ai";
import { RxParseResponse } from "@pillpal/shared";
import { ValidationError } from "../lib/http.js";
import { fileToUpload, multipartBody } from "../lib/upload.js";
import { requireUser } from "../lib/auth.js";

export const rx = new Hono();

/** Web: multipart prescription-label photo (field "image"; "photo" also accepted) → RxFields. */
rx.post("/parse", requireUser, async (c) => {
  const body = await multipartBody(c);
  const file = body.image ?? body.photo;
  if (!(file instanceof File) || file.size === 0) {
    throw new ValidationError([{ path: "image", message: "Attach the label photo as file field \"image\"" }]);
  }
  if (!file.type.startsWith("image/")) {
    throw new ValidationError([{ path: "image", message: "Must be an image" }]);
  }
  const { b64, mime } = await fileToUpload(file);
  const fields = await ai.parseRx(b64, mime);
  return c.json(RxParseResponse.parse(fields));
});
