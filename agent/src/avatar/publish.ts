/**
 * Publishes Helen as the agent's camera track (Chert shows the video from the same participant that speaks).
 * Renders ~15 fps and backs off if frames get expensive, so audio always wins. Never throws into the call.
 */
import { LocalVideoTrack, TrackPublishOptions, TrackSource, VideoBufferType, VideoFrame, VideoSource, type Room } from "@livekit/rtc-node";
import { AvatarController } from "./controller.js";
import { AvatarRenderer, H, W } from "./renderer.js";

export interface Avatar {
  controller: AvatarController;
  stop: () => Promise<void>;
}

export async function startAvatar(room: Room): Promise<Avatar | null> {
  if ((process.env.AVATAR ?? "on") === "off") return null;
  const controller = new AvatarController();
  try {
    const renderer = new AvatarRenderer();
    const source = new VideoSource(W, H);
    const track = LocalVideoTrack.createVideoTrack("pal-avatar", source);
    await room.localParticipant!.publishTrack(track, new TrackPublishOptions({ source: TrackSource.SOURCE_CAMERA }));

    let fps = Math.max(5, Math.min(24, Number(process.env.AVATAR_FPS ?? 15)));
    let running = true;
    let last = performance.now();
    let acc = 0;
    let n = 0;
    let reportAt = last + 15_000;

    const loop = () => {
      if (!running) return;
      const t0 = performance.now();
      try {
        const rig = controller.tick(Math.min(0.2, (t0 - last) / 1000));
        last = t0;
        renderer.draw(rig);
        source.captureFrame(new VideoFrame(renderer.rgba(), W, H, VideoBufferType.RGBA));
      } catch {
        /* a bad frame must never break the call */
      }
      const cost = performance.now() - t0;
      acc += cost;
      n++;
      if (t0 > reportAt) {
        const avg = acc / n;
        // back off if drawing is eating the budget (audio matters more than animation)
        if (avg > 35 && fps > 6) fps = Math.max(6, Math.floor(fps * 0.7));
        console.log(`[avatar] ${fps} fps target, avg frame ${avg.toFixed(1)} ms`);
        acc = 0;
        n = 0;
        reportAt = t0 + 15_000;
      }
      setTimeout(loop, Math.max(1, 1000 / fps - cost));
    };
    loop();

    return {
      controller,
      stop: async () => {
        running = false;
        await source.close().catch(() => undefined);
      },
    };
  } catch (err) {
    console.log(`[avatar] disabled: ${err instanceof Error ? err.message : "unknown error"}`);
    return null;
  }
}
