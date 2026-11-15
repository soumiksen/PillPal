/**
 * Chert iMessage client. One interface, three implementations chosen by CHERT_MODE:
 *  - live: real HTTP to https://console.trychert.com/api/v1 (see ./http.ts)
 *  - shared: Shared-line API https://app.trychert.com/api/v1/shared-messages (see ./shared.ts);
 *    text only — unsupported features degrade to a plain-text equivalent
 *  - mock: no network; logs "[chert-mock] <method> → patient|caregiver|…" and keeps an in-memory outbox.
 * None ever logs phone numbers, message bodies or tokens.
 */
import { randomUUID } from "node:crypto";
import { env } from "../env.js";
import { chertFetch, chertJson } from "./http.js";
import { recipientLabel } from "./labels.js";
import { SharedChertMessaging } from "./shared.js";
import type { MessageEffect, Place, ReactionKind } from "./types.js";

export { recipientLabel } from "./labels.js";

export type Attachment = { data: Buffer; mime: string };

/** What the current transport can do natively (callers pick a fallback when false). */
export type MessagingSupport = {
  reactions: boolean;
  voiceNotes: boolean;
  groupChats: boolean;
  locations: boolean;
  effects: boolean;
  /** Inbound tapbacks arrive as reaction.added events. */
  inboundReactions: boolean;
};

export interface ChertMessaging {
  readonly mode: "mock" | "live" | "shared";
  readonly supports: MessagingSupport;
  /** 1:1 iMessage (a blank line splits bubbles). → Chert message id. */
  sendText(phone: string, body: string, effect?: MessageEffect): Promise<string>;
  /** Standard tapback on any message id (ours or inbound). */
  react(messageId: string, kind: ReactionKind): Promise<void>;
  /**
   * Native voice note from a PCM WAV (0.5–300 s): stage, then send. → message id.
   * `text` is what the note says; transports without voice notes send it as a text instead.
   */
  sendVoiceNote(phone: string, wav: Buffer, text: string): Promise<string>;
  /** Group chat with 2–31 recipients; first message must be text-only, no URLs. → chat id. */
  createCareChat(recipients: string[], firstText: string): Promise<string>;
  /** Follow-up message in an existing chat. → message id. */
  postToChat(chatId: string, body: string): Promise<string>;
  /** One-time location pin. → message id. */
  sendPharmacyPin(phone: string, place: Place): Promise<string>;
  /** Bytes of an inbound media part (image, voice memo, …). */
  downloadAttachment(attachmentId: string): Promise<Attachment>;
}

// ---------------------------------------------------------------- live

const FULL_SUPPORT: MessagingSupport = {
  reactions: true,
  voiceNotes: true,
  groupChats: true,
  locations: true,
  effects: true,
  inboundReactions: true,
};

class LiveChertMessaging implements ChertMessaging {
  readonly mode = "live" as const;
  readonly supports = FULL_SUPPORT;

  async sendText(phone: string, body: string, effect?: MessageEffect): Promise<string> {
    const r = await chertJson<{ message_id: string }>("POST", "/send", {
      phone,
      body,
      ...(effect ? { effect } : {}),
      idempotency_key: `pp-text-${randomUUID()}`,
    });
    return r.message_id;
  }

  async react(messageId: string, kind: ReactionKind): Promise<void> {
    await chertJson("POST", `/messages/${encodeURIComponent(messageId)}/react`, { reaction: kind });
  }

  async sendVoiceNote(phone: string, wav: Buffer, _text: string): Promise<string> {
    const staged = await chertJson<{ voice_note_id: string; phone_line_id: string }>(
      "POST",
      "/voice-notes",
      { audio_base64: wav.toString("base64"), mime_type: "audio/wav" },
    );
    // Same phone_line_id as staging: staged ids are line-local and expire in 15 min.
    const r = await chertJson<{ message_id: string }>("POST", "/send", {
      phone,
      phone_line_id: staged.phone_line_id,
      voice_note: { voice_note_id: staged.voice_note_id },
      idempotency_key: `pp-vn-${randomUUID()}`,
    });
    return r.message_id;
  }

  async createCareChat(recipients: string[], firstText: string): Promise<string> {
    if (recipients.length < 2 || recipients.length > 31) {
      throw new Error("createCareChat needs 2–31 recipients");
    }
    const r = await chertJson<{ chat: { id: string } }>("POST", "/chats", {
      from: env.CHERT_FROM,
      to: recipients,
      message: {
        subject: "PillPal Care Circle",
        parts: [{ type: "text", value: firstText }],
        idempotency_key: `pp-chat-${randomUUID()}`,
      },
    });
    return r.chat.id;
  }

  async postToChat(chatId: string, body: string): Promise<string> {
    const r = await chertJson<{ message: { id: string } }>(
      "POST",
      `/chats/${encodeURIComponent(chatId)}/messages`,
      { message: { parts: [{ type: "text", value: body }], idempotency_key: `pp-post-${randomUUID()}` } },
    );
    return r.message.id;
  }

  async sendPharmacyPin(phone: string, place: Place): Promise<string> {
    const r = await chertJson<{ message_id: string }>("POST", "/locations", {
      phone,
      latitude: place.latitude,
      longitude: place.longitude,
      ...(place.label ? { label: place.label } : {}),
      ...(place.address ? { address: place.address } : {}),
      fallback_mode: "auto",
      idempotency_key: `pp-loc-${randomUUID()}`,
    });
    return r.message_id;
  }

  async downloadAttachment(attachmentId: string): Promise<Attachment> {
    const res = await chertFetch("GET", `/attachments/${encodeURIComponent(attachmentId)}/content`);
    return {
      data: Buffer.from(await res.arrayBuffer()),
      mime: res.headers.get("content-type") ?? "application/octet-stream",
    };
  }
}

// ---------------------------------------------------------------- mock

export type OutboxKind = "text" | "reaction" | "voice_note" | "chat_create" | "chat_post" | "location";
/** What the mock outbox keeps: no phones, no bodies. */
export type OutboxEntry = { id: string; kind: OutboxKind; to: string; effect?: string; at: string };

const OUTBOX_MAX = 200;

class MockChertMessaging implements ChertMessaging {
  readonly mode = "mock" as const;
  readonly supports = FULL_SUPPORT;
  readonly outbox: OutboxEntry[] = [];

  private record(kind: OutboxKind, method: string, to: string, extra?: { effect?: string }): string {
    const id = kind === "chat_create" ? `mock_chat_${randomUUID()}` : `mock_msg_${randomUUID()}`;
    this.outbox.push({ id, kind, to, ...extra, at: new Date().toISOString() });
    if (this.outbox.length > OUTBOX_MAX) this.outbox.shift();
    console.log(`[chert-mock] ${method} → ${to}`);
    return id;
  }

  async sendText(phone: string, _body: string, effect?: MessageEffect): Promise<string> {
    return this.record("text", "sendText", recipientLabel(phone), effect ? { effect } : undefined);
  }

  async react(_messageId: string, _kind: ReactionKind): Promise<void> {
    this.record("reaction", "react", "message");
  }

  async sendVoiceNote(phone: string, _wav: Buffer, _text: string): Promise<string> {
    return this.record("voice_note", "sendVoiceNote", recipientLabel(phone));
  }

  async createCareChat(recipients: string[], _firstText: string): Promise<string> {
    if (recipients.length < 2 || recipients.length > 31) {
      throw new Error("createCareChat needs 2–31 recipients");
    }
    return this.record("chat_create", "createCareChat", "care-chat");
  }

  async postToChat(_chatId: string, _body: string): Promise<string> {
    return this.record("chat_post", "postToChat", "care-chat");
  }

  async sendPharmacyPin(phone: string, _place: Place): Promise<string> {
    return this.record("location", "sendPharmacyPin", recipientLabel(phone));
  }

  async downloadAttachment(attachmentId: string): Promise<Attachment> {
    console.log("[chert-mock] downloadAttachment");
    // Tiny fake JPEG (SOI + id bytes + EOI): enough to exercise the image → checkPill path.
    const body = Buffer.from(attachmentId, "utf8");
    return { data: Buffer.concat([Buffer.from([0xff, 0xd8]), body, Buffer.from([0xff, 0xd9])]), mime: "image/jpeg" };
  }
}

// ---------------------------------------------------------------- selection

const mockInstance = env.CHERT_MODE === "mock" ? new MockChertMessaging() : undefined;
const sharedInstance = env.CHERT_MODE === "shared" ? new SharedChertMessaging() : undefined;

export const messaging: ChertMessaging = mockInstance ?? sharedInstance ?? new LiveChertMessaging();

/** The shared-line client (undefined unless CHERT_MODE=shared). */
export const sharedMessaging = (): SharedChertMessaging | undefined => sharedInstance;

/** Mock outbox (undefined in live mode). */
export function mockOutbox(): readonly OutboxEntry[] | undefined {
  return mockInstance?.outbox;
}
