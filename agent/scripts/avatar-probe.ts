/** Joins the LOCAL LiveKit room as a viewer and saves one frame of the agent's avatar video: proves the track publishes. */
import { writeFileSync } from "node:fs";
import { Room, RoomEvent, TrackKind, VideoBufferType, VideoStream } from "@livekit/rtc-node";
import sharp from "sharp";

const out = process.argv[2] ?? "avatar-probe.png";
const res = await fetch("http://localhost:8788/token");
const { token, url } = (await res.json()) as { token: string; url?: string };
const room = new Room();
const got = new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("no avatar video within 40 s")), 40_000);
  room.on(RoomEvent.TrackSubscribed, async (track, _pub, p) => {
    if (track.kind !== TrackKind.KIND_VIDEO) return;
    console.log("video track from", p.identity.slice(0, 12));
    const stream = new VideoStream(track);
    let n = 0;
    for await (const ev of stream) {
      if (++n < 20) continue; // let a few frames pass so expressions have settled
      const f = ev.frame.convert(VideoBufferType.RGBA);
      await sharp(Buffer.from(f.data), { raw: { width: f.width, height: f.height, channels: 4 } }).png().toFile(out);
      console.log(`saved ${f.width}x${f.height} frame`);
      clearTimeout(timer);
      resolve();
      return;
    }
  });
});
await room.connect(url ?? "ws://localhost:7880", token);
await got;
await room.disconnect();
process.exit(0);
