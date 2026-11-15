import type { voice } from "@livekit/agents";
import type { Room } from "@livekit/rtc-node";
import { avatarProvider, portraitPath, selectAvatar } from "./catalog.js";
import { startIllustratedAvatar, type AvatarHandle } from "./video.js";

/** Before AgentSession.start: the hosted plugin owns audio output as well as video. */
export async function startAvatar(session: voice.AgentSession, room: Room, patientId: string, requested?: unknown): Promise<AvatarHandle> {
  let provider = avatarProvider(process.env.PAL_AVATAR_PROVIDER);
  if (provider === "off") return { close: async () => undefined };
  const avatar = selectAvatar(patientId, requested, process.env.PAL_AVATAR);
  if (provider === "lemonslice" && !process.env.LEMONSLICE_API_KEY) {
    console.warn("[pal-avatar] LEMONSLICE_API_KEY unset; using built-in illustration");
    provider = "illustrated";
  }
  console.log(`[pal-avatar] ${avatar.id} / ${provider}`);
  if (provider === "illustrated") {
    try {
      return await startIllustratedAvatar(session, room, avatar);
    } catch {
      console.warn("[pal-avatar] video unavailable; voice continues");
      return { close: async () => undefined };
    }
  }
  const { AvatarSession } = await import("@livekit/agents-plugin-lemonslice");
  const hosted = new AvatarSession({
    agentImage: portraitPath(avatar),
    avatarParticipantIdentity: "pillpal-odyssey-avatar",
    avatarParticipantName: `Pal · ${avatar.name}`,
    agentPrompt: "Warm, reassuring companion. Gentle natural mouth movements, occasional blinks, subtle nods. Face the camera. Keep the original character design and anatomy. No sudden gestures.",
    agentIdlePrompt: "Listen attentively with a relaxed smile and gentle breathing. Keep the original face and anatomy.",
    connOptions: { maxRetry: 0, retryIntervalMs: 0, timeoutMs: 8000 },
  });
  try {
    await hosted.start(session, room);
    return { close: () => hosted.aclose() };
  } catch {
    await hosted.aclose().catch(() => undefined);
    // A provisioning timeout may still create a remote audio publisher. Do not silently
    // start a second publisher; Chert requires exactly one. Retry in illustrated mode.
    throw new Error("Hosted avatar could not start. Check provider access or use PAL_AVATAR_PROVIDER=illustrated.");
  }
}
