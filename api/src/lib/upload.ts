/** Multipart helpers. */
import type { Context } from "hono";
import { ValidationError } from "./http.js";

export type Upload = { b64: string; mime: string };

export async function fileToUpload(file: File): Promise<Upload> {
  const buf = Buffer.from(await file.arrayBuffer());
  return { b64: buf.toString("base64"), mime: file.type || "application/octet-stream" };
}

export function isMultipart(c: Context): boolean {
  return (c.req.header("content-type") ?? "").toLowerCase().startsWith("multipart/form-data");
}

/** Parse multipart body; throws a 400 when it is not multipart. */
export async function multipartBody(c: Context): Promise<Record<string, string | File>> {
  if (!isMultipart(c)) {
    throw new ValidationError([{ path: "(body)", message: "Expected multipart/form-data" }]);
  }
  const body = await c.req.parseBody();
  const out: Record<string, string | File> = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = Array.isArray(v) ? (v[0] as string | File) : (v as string | File);
  }
  return out;
}
