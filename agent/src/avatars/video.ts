import { voice } from "@livekit/agents";
import { LocalVideoTrack, TrackPublishOptions, TrackSource, VideoBufferType, VideoFrame, VideoSource, type Room } from "@livekit/rtc-node";
import sharp from "sharp";
import type { Avatar } from "./catalog.js";
import { avatarSvg, AVATAR_HEIGHT, AVATAR_WIDTH, type AvatarState } from "./illustration.js";

export interface AvatarHandle { close(): Promise<void> }

/** Publishes video on the voice agent itself: Chert still sees exactly one audio publisher. */
export async function startIllustratedAvatar(session: voice.AgentSession, room: Room, avatar: Avatar): Promise<AvatarHandle> {
  const participant = room.localParticipant;
  if (!participant) throw new Error("Avatar needs a connected LiveKit participant");
  const source = new VideoSource(AVATAR_WIDTH, AVATAR_HEIGHT);
  const track = LocalVideoTrack.createVideoTrack("pal-avatar-video", source);
  let closed = false;
  let sid: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  let state: AvatarState = session.agentState;
  const started = performance.now();
  const onState = (event: voice.AgentStateChangedEvent) => { state = event.newState; };
  const close = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    session.off(voice.AgentSessionEventTypes.AgentStateChanged, onState);
    session.off(voice.AgentSessionEventTypes.Close, onClose);
    await inFlight.catch(() => undefined);
    if (sid && room.isConnected) await participant.unpublishTrack(sid, false).catch(() => undefined);
    await track.close(); // closes its VideoSource too
  };
  const onClose = () => { void close(); };
  const draw = async () => {
    const now = performance.now();
    const rgba = await sharp(Buffer.from(avatarSvg(avatar, (now - started) / 1000, state))).ensureAlpha().raw().toBuffer();
    if (!closed) source.captureFrame(new VideoFrame(new Uint8Array(rgba), AVATAR_WIDTH, AVATAR_HEIGHT, VideoBufferType.RGBA));
  };
  const tick = () => {
    inFlight = draw().catch(() => {
      // Video is optional: a rendering failure must not tear down the care conversation.
      console.warn("[pal-avatar] illustration stopped; voice continues");
      void close();
    }).then(() => {
      if (!closed) timer = setTimeout(tick, 1000 / 24);
    });
  };
  try {
    const options = new TrackPublishOptions();
    options.source = TrackSource.SOURCE_CAMERA;
    const publication = await participant.publishTrack(track, options);
    sid = publication.sid;
    await draw();
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, onState);
    session.on(voice.AgentSessionEventTypes.Close, onClose);
    tick();
    return { close };
  } catch (error) {
    await close();
    throw error;
  }
}
