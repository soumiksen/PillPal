/**
 * Shared-line iMessage (CHERT_MODE=shared), per https://app.trychert.com/skills.md "HTTP API":
 *
 *   POST {APP_BASE}/shared-messages   {"line_id": "<line UUID>", "recipient": "<verified phone>", "text": "…"}
 *   GET  {APP_BASE}/shared-messages   newest 50 messages, sent and received (polled by ./shared-poll.ts)
 *   GET  {APP_BASE}/shared-messages/attachments/{id}   60-second download URL for a stored image
 *
 * Auth: Bearer CHERT_API_KEY + X-Chert-Project-Id; every POST has a fresh Idempotency-Key.
 * Text only (≤ 4,000 chars). Reactions, voice notes, group chats, location pins and effects are
 * not offered on Shared, so each degrades to a plain-text equivalent or a "[shared] … not supported" log.
 * Rate guard: at most 90 sends per rolling hour (plan limit is 100/hour per project).
 */
import { env } from "../env.js";
import { HourlyRateGuard } from "../lib/rate-guard.js";
import { recipientLabel } from "./labels.js";
import type { Attachment, ChertMessaging, MessagingSupport } from "./messaging.js";
import { APP_BASE, idempotencyKey, pickString, projectFetch, projectJson } from "./project-http.js";
import type { MessageEffect, Place, ReactionKind } from "./types.js";

export const SHARED_MAX_PER_HOUR = 90;
const MAX_TEXT = 4000;

const SHARED_SUPPORT: MessagingSupport = {
  reactions: false,
  voiceNotes: false,
  groupChats: false,
  locations: false,
  effects: false,
  inboundReactions: false,
};

export class UnsupportedOnShared extends Error {
  constructor(method: string) {
    super(`${method} is not supported on a Shared line`);
    this.name = "UnsupportedOnShared";
  }
}

export class SharedChertMessaging implements ChertMessaging {
  readonly mode = "shared" as const;
  readonly supports = SHARED_SUPPORT;
  readonly guard = new HourlyRateGuard("shared_messages", SHARED_MAX_PER_HOUR);
  /** Ids of messages we sent (lets the poller skip our own messages even if direction is missing). */
  readonly sentIds = new Set<string>();

  async sendText(phone: string, body: string, effect?: MessageEffect): Promise<string> {
    let text = body;
    if (effect) {
      // No screen effects on Shared: a celebration becomes a 🎉 text.
      if (effect === "celebration" && !text.includes("🎉")) text = `🎉 ${text}`;
      console.log(`[shared] effect "${effect}" not supported, sent as plain text`);
    }
    if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT - 1)}…`;
    if (!env.CHERT_LINE_ID) throw new Error("CHERT_LINE_ID is not set");
    this.guard.take();
    const json = await projectJson({
      base: APP_BASE,
      method: "POST",
      path: "/shared-messages",
      body: { line_id: env.CHERT_LINE_ID, recipient: phone, text },
      idempotencyKey: idempotencyKey("shared-text"),
    });
    // Response shape is not documented: take the message id from data.id / id (or *_id variants).
    const id = pickString(json, ["id", "message_id", "shared_message_id"]);
    if (!id) throw new Error("shared-messages response had no message id");
    this.sentIds.add(id);
    console.log(`[shared] sendText → ${recipientLabel(phone)} (${this.guard.used}/${SHARED_MAX_PER_HOUR} this hour)`);
    return id;
  }

  async react(_messageId: string, kind: ReactionKind): Promise<void> {
    console.log(`[shared] react not supported (skipped ${kind})`);
  }

  async sendVoiceNote(phone: string, _wav: Buffer, text: string): Promise<string> {
    console.log("[shared] sendVoiceNote not supported, sending its text instead");
    return this.sendText(phone, `🔊 ${text}`);
  }

  async createCareChat(_recipients: string[], _firstText: string): Promise<string> {
    console.log("[shared] createCareChat not supported");
    throw new UnsupportedOnShared("createCareChat");
  }

  async postToChat(_chatId: string, _body: string): Promise<string> {
    console.log("[shared] postToChat not supported");
    throw new UnsupportedOnShared("postToChat");
  }

  async sendPharmacyPin(phone: string, place: Place): Promise<string> {
    console.log("[shared] sendPharmacyPin not supported, sending name/address as text");
    const lines = [`📍 ${place.label ?? "Pharmacy"}`];
    if (place.address) lines.push(place.address);
    lines.push(`https://maps.apple.com/?ll=${place.latitude},${place.longitude}`);
    return this.sendText(phone, lines.join("\n"));
  }

  async downloadAttachment(attachmentId: string): Promise<Attachment> {
    const json = await projectJson({
      base: APP_BASE,
      method: "GET",
      path: `/shared-messages/attachments/${encodeURIComponent(attachmentId)}`,
    });
    const url = pickString(json, ["url", "download_url", "signed_url"]);
    if (!url) throw new Error("shared attachment response had no download url");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`shared attachment download → ${res.status}`);
    return {
      data: Buffer.from(await res.arrayBuffer()),
      mime: res.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  /** GET /shared-messages (newest 50, sent and received). Raw JSON; ./shared-poll.ts normalizes it. */
  async listRecent(): Promise<unknown> {
    const res = await projectFetch({ base: APP_BASE, method: "GET", path: "/shared-messages" });
    return res.json();
  }
}
