/**
 * HTTP client for Chert's project API (key `ftk_…`), used by:
 *  - shared-line iMessage: https://app.trychert.com/api/v1/shared-messages   (skills.md "HTTP API")
 *  - FaceTime Calls API:   https://facetime.trychert.com/api/v1/calls       (docs facetime/calls-api)
 *
 * Headers on every request: Authorization: Bearer CHERT_API_KEY, X-Chert-Project-Id: CHERT_PROJECT_ID.
 * Every POST carries a fresh Idempotency-Key (8–200 chars); retries reuse the same key, so a retried
 * create returns the original object instead of a duplicate.
 * Errors use the documented envelope {error:{code,message}, request_id}. Logs carry method, a
 * redacted path, status and code only — never bodies, phones or the key.
 */
import { randomUUID } from "node:crypto";
import { env } from "../env.js";

export const APP_BASE = env.CHERT_APP_BASE ?? "https://app.trychert.com/api/v1";
export const FACETIME_BASE = env.CHERT_FACETIME_BASE ?? "https://facetime.trychert.com/api";

const MAX_ATTEMPTS = 3;

export class ChertApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly status: number,
    public readonly code: string | undefined,
  ) {
    super(`chert ${method} ${path} → ${status}${code ? ` (${code})` : ""}`);
    this.name = "ChertApiError";
  }
}

/** A fresh idempotency key: `pp-<purpose>-<uuid>` (always within 8–200 chars). */
export function idempotencyKey(purpose: string): string {
  return `pp-${purpose.replace(/[^a-z0-9-]/gi, "").slice(0, 40)}-${randomUUID()}`;
}

function safePath(path: string): string {
  return path.split("?")[0]!.replace(/\/[^/]*[0-9][^/]*(?=\/|$)/g, "/:id");
}

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const j = (await res.json()) as { error?: { code?: unknown } | string; code?: unknown };
    if (typeof j.error === "object" && j.error?.code !== undefined) return String(j.error.code);
    if (typeof j.error === "string") return j.error;
    return j.code !== undefined ? String(j.code) : undefined;
  } catch {
    return undefined;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ProjectRequest = {
  base: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
  /** Required for POST; reused across retries. */
  idempotencyKey?: string;
};

export async function projectFetch(req: ProjectRequest): Promise<Response> {
  if (!env.CHERT_API_KEY || !env.CHERT_PROJECT_ID) throw new Error("CHERT_API_KEY / CHERT_PROJECT_ID are not set");
  const headers: Record<string, string> = {
    authorization: `Bearer ${env.CHERT_API_KEY}`,
    "x-chert-project-id": env.CHERT_PROJECT_ID,
  };
  if (req.method === "POST") headers["idempotency-key"] = req.idempotencyKey ?? idempotencyKey("req");
  if (req.body !== undefined) headers["content-type"] = "application/json";
  const init: RequestInit = {
    method: req.method,
    headers,
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
  };
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${req.base}${req.path}`, init);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw err;
      await sleep(400 * 2 ** (attempt - 1));
      continue;
    }
    if (res.ok) return res;
    const code = await errorCode(res);
    if (res.status < 500 || attempt >= MAX_ATTEMPTS) {
      const e = new ChertApiError(req.method, safePath(req.path), res.status, code);
      console.error(`[chert-api] ${e.message}`);
      throw e;
    }
    console.warn(`[chert-api] ${req.method} ${safePath(req.path)} → ${res.status}, retry ${attempt}/${MAX_ATTEMPTS - 1}`);
    await sleep(400 * 2 ** (attempt - 1));
  }
}

export async function projectJson<T = unknown>(req: ProjectRequest): Promise<T> {
  const res = await projectFetch(req);
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

/**
 * The documented FaceTime envelope is {data, request_id}; shared-message responses are not
 * documented, so accept `data.<k>` or a top-level `<k>`.
 */
export function pickString(json: unknown, keys: string[]): string | undefined {
  const obj = (json ?? {}) as Record<string, unknown>;
  const layers = [obj.data, obj.message, (obj.data as Record<string, unknown> | undefined)?.message, obj];
  for (const layer of layers) {
    if (!layer || typeof layer !== "object") continue;
    for (const k of keys) {
      const v = (layer as Record<string, unknown>)[k];
      if (typeof v === "string" && v) return v;
    }
  }
  return undefined;
}

/** Top-level + `data` field names only (for ping/diagnostic logs; never values). */
export function fieldNames(json: unknown): string {
  const obj = (json ?? {}) as Record<string, unknown>;
  const top = Object.keys(obj);
  const data = obj.data;
  const inner = Array.isArray(data)
    ? data[0] && typeof data[0] === "object" ? `data[]: ${Object.keys(data[0] as object).join(", ")}` : "data[]: (empty)"
    : data && typeof data === "object" ? `data: ${Object.keys(data).join(", ")}` : "";
  return [`top: ${top.join(", ")}`, inner].filter(Boolean).join(" | ");
}
