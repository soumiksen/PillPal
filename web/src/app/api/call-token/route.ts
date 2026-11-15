/**
 * POST /api/call-token {role, room_name, code, name?, check?} → {url, token, identity}
 * Mints a LiveKit token for one of our call rooms (pillpal-*), only for holders of DEMO_ACCESS_CODE.
 * identity patient-web-<uuid> | caregiver-web-<uuid>; join/publish/subscribe on that room only; 1 h TTL.
 * Server-only env: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, DEMO_ACCESS_CODE. Never logs secrets.
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { CallTokenBody, ROOM_PREFIX, identityPrefix, type CallTokenResponse } from "@pillpal/shared";

const noStore = { "cache-control": "no-store" };
const fail = (status: number, error: string) => Response.json({ error }, { status, headers: noStore });

const sameSecret = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

export async function POST(req: Request): Promise<Response> {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret, DEMO_ACCESS_CODE: code } = process.env;
  if (!url || !key || !secret || !code) return fail(503, "not_configured");

  let body: CallTokenBody;
  try {
    body = CallTokenBody.parse(await req.json());
  } catch {
    return fail(400, "bad_request");
  }
  if (!sameSecret(body.code.trim(), code.trim())) return fail(401, "wrong_code");
  if (body.check) return Response.json({ ok: true }, { headers: noStore });
  if (!body.room_name.startsWith(ROOM_PREFIX) || !/^[a-z0-9_-]+$/i.test(body.room_name)) return fail(400, "bad_room");

  const identity = `${identityPrefix(body.role)}${randomUUID()}`;
  const at = new AccessToken(key, secret, {
    identity,
    name: body.name?.trim() || (body.role === "patient" ? "Patient" : "Caregiver"),
    ttl: 3600,
    metadata: JSON.stringify({ role: body.role }),
  });
  at.addGrant({ room: body.room_name, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
  const token = await at.toJwt();
  return Response.json({ url, token, identity } satisfies CallTokenResponse, { headers: noStore });
}
