/**
 * Inbound for CHERT_MODE=shared. Shared lines have no documented stream or webhook; the only read
 * path is GET /shared-messages (newest 50, sent and received). We poll it every 5 s, turn each new
 * inbound message into a `message.received` envelope and feed handleEvent() (dedupe on
 * event_id = "shared:<message id>").
 *
 * The list's item shape is not documented, so normalize() accepts the common spellings and logs the
 * field NAMES (never values) once if it cannot find an id, direction or sender.
 * Messages older than the poller's start (minus 2 min) are ignored so a restart never replays history.
 */
import { handleEvent } from "./events.js";
import type { SharedChertMessaging } from "./shared.js";
import type { MessagePart, MessageReceivedEvent } from "./types.js";

export const SHARED_POLL_MS = 5000;
const REPLAY_GRACE_MS = 2 * 60_000;

type Item = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

function handleOf(v: unknown): string | undefined {
  if (typeof v === "string") return v || undefined;
  if (v && typeof v === "object") {
    const o = v as Item;
    return str(o.handle) ?? str(o.phone) ?? str(o.phone_number) ?? str(o.value) ?? str(o.address);
  }
  return undefined;
}

/** Items array from `{data:[…]}`, `{messages:[…]}`, `{data:{messages:[…]}}` or a bare array. */
export function listItems(json: unknown): Item[] {
  if (Array.isArray(json)) return json as Item[];
  const o = (json ?? {}) as Item;
  for (const c of [o.data, o.messages, o.items, (o.data as Item | undefined)?.messages]) {
    if (Array.isArray(c)) return c as Item[];
  }
  return [];
}

export type NormalizedShared = {
  id: string;
  inbound: boolean;
  sender?: string;
  text?: string;
  attachmentIds: string[];
  at?: string;
};

export function normalize(item: Item, ownIds: ReadonlySet<string>): NormalizedShared | undefined {
  const id = str(item.id) ?? str(item.message_id);
  if (!id) return undefined;
  const dir = (str(item.direction) ?? str(item.type) ?? "").toLowerCase();
  let inbound: boolean | undefined;
  if (["inbound", "received", "incoming", "in"].includes(dir)) inbound = true;
  else if (["outbound", "sent", "outgoing", "out"].includes(dir)) inbound = false;
  else if (typeof item.is_inbound === "boolean") inbound = item.is_inbound;
  else if (typeof item.from_me === "boolean") inbound = !item.from_me;
  else if (typeof item.is_from_me === "boolean") inbound = !item.is_from_me;
  if (ownIds.has(id)) inbound = false;
  if (inbound === undefined) return undefined;

  const sender =
    handleOf(item.sender) ?? handleOf(item.from) ?? handleOf(item.sender_handle) ?? handleOf(item.handle) ??
    (inbound ? handleOf(item.phone) ?? handleOf(item.recipient) : undefined);
  const text = str(item.text) ?? str(item.body);
  const attachmentIds: string[] = [];
  if (Array.isArray(item.attachments)) {
    for (const a of item.attachments) {
      const aid = typeof a === "string" ? a : str((a as Item)?.attachment_id) ?? str((a as Item)?.id);
      if (aid) attachmentIds.push(aid);
    }
  }
  return {
    id,
    inbound,
    sender,
    text,
    attachmentIds,
    at: str(item.created_at) ?? str(item.sent_at) ?? str(item.received_at),
  };
}

export function toEnvelope(m: NormalizedShared): MessageReceivedEvent {
  const parts: MessagePart[] = [];
  if (m.text) parts.push({ type: "text", value: m.text });
  // Shared attachments are images only (JPEG/PNG).
  for (const aid of m.attachmentIds) parts.push({ type: "media", attachment_id: aid, mime_type: "image/jpeg" });
  return {
    event_id: `shared:${m.id}`,
    event_type: "message.received",
    created_at: m.at,
    api_version: "shared",
    data: {
      message: {
        id: m.id,
        direction: "inbound",
        sender_handle: m.sender ? { handle: m.sender, is_me: false } : undefined,
        parts,
        sent_at: m.at,
        service: "imessage",
      },
    },
  };
}

/** One poll: returns how many new inbound messages were handed to handleEvent. */
export async function pollOnce(client: SharedChertMessaging, since: number, warned: { shape: boolean }): Promise<number> {
  const items = listItems(await client.listRecent());
  let handled = 0;
  for (const item of items.slice().reverse()) {
    const m = normalize(item, client.sentIds);
    if (!m) {
      if (!warned.shape) {
        warned.shape = true;
        console.warn(`[shared] poll: unrecognized message shape, fields: ${Object.keys(item).join(", ")}`);
      }
      continue;
    }
    if (!m.inbound) continue;
    if (m.at && Date.parse(m.at) < since) continue;
    if (!m.sender) continue;
    try {
      const r = await handleEvent(toEnvelope(m));
      if (r.status !== "duplicate") handled++;
    } catch (err) {
      console.error(`[shared] inbound message failed: ${(err as Error).message}`);
    }
  }
  return handled;
}

export function startSharedPoller(client: SharedChertMessaging, signal?: AbortSignal): void {
  const since = Date.now() - REPLAY_GRACE_MS;
  const warned = { shape: false };
  let running = false;
  let lastError = "";
  console.log(`[shared] polling GET /shared-messages every ${SHARED_POLL_MS / 1000}s`);
  const timer = setInterval(async () => {
    if (running || signal?.aborted) return;
    running = true;
    try {
      await pollOnce(client, since, warned);
      lastError = "";
    } catch (err) {
      const msg = (err as Error).message;
      if (msg !== lastError) console.error(`[shared] poll failed: ${msg}`);
      lastError = msg;
    } finally {
      running = false;
    }
  }, SHARED_POLL_MS);
  signal?.addEventListener("abort", () => clearInterval(timer));
}
