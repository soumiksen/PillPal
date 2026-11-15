/**
 * Publishes Helen as the agent's camera track (Chert shows the video from the same participant that speaks).
 * PAL_AVATAR_STYLE=portrait (default) draws the aligned portrait frames; vector draws the stylised Helen.
 * Portrait falls back to vector if its frames fail to load or a frame throws. Renders ~15 fps; a late tick is
 * dropped rather than caught up, and the rate backs off if frames get expensive, so audio always wins.
 * Never throws into the call.
 */
import { LocalVideoTrack, TrackPublishOptions, TrackSource, VideoBufferType, VideoFrame, VideoSource, type Room } from "@livekit/rtc-node";
import { AvatarController } from "./controller.js";
import { PortraitRenderer, loadPortraitAssets } from "./portrait.js";
import { AvatarRenderer, H, W } from "./renderer.js";
import type { ExpressionName, Rig } from "./rig.js";

export interface Avatar {
  controller: AvatarController;
  stop: () => Promise<void>;
}

export interface FaceRenderer {
  readonly style: "portrait" | "vector";
  draw(r: Rig, expr: ExpressionName): void;
  rgba(): Uint8Array;
}

const LOAD_TIMEOUT_MS = 4000;

/** Portrait if asked for and loadable, otherwise vector. Never rejects. */
export async function createFaceRenderer(style = process.env.PAL_AVATAR_STYLE ?? "portrait"): Promise<FaceRenderer> {
  const vector = (): FaceRenderer => {
    const v = new AvatarRenderer();
    return { style: "vector", draw: (r) => v.draw(r), rgba: () => v.rgba() };
  };
  if (style === "vector") return vector();
  try {
    const assets = await Promise.race([
      loadPortraitAssets(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("frames took too long to load")), LOAD_TIMEOUT_MS)),
    ]);
    const p = new PortraitRenderer(assets);
    console.log(`[avatar] portrait frames loaded (${(assets.bytes / 1e6).toFixed(1)} MB decoded)`);
    return { style: "portrait", draw: (r, e) => p.draw(r, e), rgba: () => p.rgba() };
  } catch (err) {
    console.log(`[avatar] portrait unavailable, using vector Helen: ${err instanceof Error ? err.message : "unknown error"}`);
    return vector();
  }
}

export async function startAvatar(room: Room): Promise<Avatar | null> {
  if ((process.env.AVATAR ?? "on") === "off") return null;
  const controller = new AvatarController();
  try {
    let renderer = await createFaceRenderer();
    const source = new VideoSource(W, H);
    const track = LocalVideoTrack.createVideoTrack("pal-avatar", source);
    await room.localParticipant!.publishTrack(track, new TrackPublishOptions({ source: TrackSource.SOURCE_CAMERA }));

    let fps = Math.max(5, Math.min(24, Number(process.env.AVATAR_FPS ?? 15)));
    let running = true;
    let last = performance.now();
    let due = last;
    let acc = 0;
    let n = 0;
    let dropped = 0;
    let failures = 0;
    let reportAt = last + 15_000;

    const loop = () => {
      if (!running) return;
      const t0 = performance.now();
      const interval = 1000 / fps;
      // Late by more than a frame (event loop busy with audio/tools): skip this one, don't catch up.
      if (t0 - due > interval) {
        dropped++;
        due = t0 + interval;
        setTimeout(loop, interval);
        return;
      }
      try {
        const rig = controller.tick(Math.min(0.2, (t0 - last) / 1000));
        last = t0;
        renderer.draw(rig, controller.expression);
        source.captureFrame(new VideoFrame(renderer.rgba(), W, H, VideoBufferType.RGBA));
        failures = 0;
      } catch {
        // a bad frame must never break the call; a portrait that keeps failing hands over to vector Helen
        if (++failures >= 5 && renderer.style === "portrait") {
          console.log("[avatar] portrait frames failing, switching to vector Helen");
          void createFaceRenderer("vector").then((v) => (renderer = v));
          failures = 0;
        }
      }
      const cost = performance.now() - t0;
      acc += cost;
      n++;
      if (t0 > reportAt) {
        const avg = acc / n;
        // back off if drawing is eating the budget (audio matters more than animation)
        if (avg > 35 && fps > 6) fps = Math.max(6, Math.floor(fps * 0.7));
        console.log(`[avatar] ${renderer.style} ${fps} fps target, avg frame ${avg.toFixed(1)} ms, dropped ${dropped}`);
        acc = 0;
        n = 0;
        dropped = 0;
        reportAt = t0 + 15_000;
      }
      due += interval;
      setTimeout(loop, Math.max(1, due - performance.now()));
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
