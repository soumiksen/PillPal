/** Supabase Storage helpers (buckets are created on first use). */
import { randomUUID } from "node:crypto";
import { db } from "../db.js";

export const PILL_PHOTOS = "pill-photos"; // public read: reference photos shown on the dashboard
export const EVIDENCE = "evidence"; // private: dose evidence frames, shared via signed URL

const EVIDENCE_URL_TTL_S = 7 * 24 * 3600;

const ensured = new Map<string, Promise<void>>();

function ensureBucket(name: string, isPublic: boolean): Promise<void> {
  let p = ensured.get(name);
  if (!p) {
    p = (async () => {
      const got = await db.storage.getBucket(name);
      if (!got.error) return;
      const made = await db.storage.createBucket(name, { public: isPublic });
      // Another request may have created it concurrently.
      if (made.error && !/already exists/i.test(made.error.message)) {
        throw new Error(`create bucket ${name}: ${made.error.message}`);
      }
    })();
    p.catch(() => ensured.delete(name));
    ensured.set(name, p);
  }
  return p;
}

/** Guess an image mime from magic bytes (JSON uploads carry bare base64). */
export function sniffImageMime(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "image/jpeg";
}

const EXT: Record<string, string> = { "image/png": "png", "image/gif": "gif", "image/webp": "webp" };

/** Strip an optional data-URL prefix. */
export function b64ToBuffer(b64: string): Buffer {
  return Buffer.from(b64.replace(/^data:[^,]*,/, ""), "base64");
}

async function upload(bucket: string, isPublic: boolean, folder: string, b64: string, mime?: string) {
  await ensureBucket(bucket, isPublic);
  const buf = b64ToBuffer(b64);
  const type = mime && mime.startsWith("image/") ? mime : sniffImageMime(buf);
  const path = `${folder}/${randomUUID()}.${EXT[type] ?? "jpg"}`;
  const up = await db.storage.from(bucket).upload(path, buf, { contentType: type, upsert: false });
  if (up.error) throw new Error(`upload to ${bucket}: ${up.error.message}`);
  return path;
}

/** Reference pill photo → public URL. */
export async function uploadPillPhoto(patientId: string, b64: string, mime?: string): Promise<string> {
  const path = await upload(PILL_PHOTOS, true, patientId, b64, mime);
  return db.storage.from(PILL_PHOTOS).getPublicUrl(path).data.publicUrl;
}

/** Dose evidence frame → signed URL (7 days). */
export async function uploadEvidence(patientId: string, b64: string): Promise<string> {
  const path = await upload(EVIDENCE, false, patientId, b64, "image/jpeg");
  const signed = await db.storage.from(EVIDENCE).createSignedUrl(path, EVIDENCE_URL_TTL_S);
  if (signed.error) throw new Error(`sign evidence url: ${signed.error.message}`);
  return signed.data.signedUrl;
}
