/**
 * Latest-frame grabber for the patient's camera: the Chert bridge track `facetime-remote-video`, or (web calls) the
 * camera of the patient-web-* participant. The caregiver's camera is never used for pill or plate checks.
 * Keeps only the newest frame + timestamp; grabFrame() → 512 px JPEG base64, or "camera_off"
 * when there is no fresh frame (older than 1.5 s) or the track is muted/unsubscribed.
 */
import {
  RemoteTrackPublication,
  RoomEvent,
  TrackKind,
  TrackSource,
  VideoBufferType,
  VideoStream,
  type RemoteParticipant,
  type Room,
  type VideoFrame,
} from "@livekit/rtc-node";
import sharp from "sharp";

export const VIDEO_TRACK_NAME = "facetime-remote-video";
export const MAX_FRAME_AGE_MS = 1500;
export const FRAME_PX = 512;

export type Grab = { ok: true; jpegB64: string } | { ok: false; reason: "camera_off" };

export class FrameGrabber {
  private latest?: { frame: VideoFrame; at: number };
  private muted = false;
  private stream?: VideoStream;
  private gen = 0;
  private trackSid?: string;

  /** Register handlers BEFORE room.connect so an already-published track is not missed. */
  attach(room: Room): void {
    room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
      if (track.kind !== TrackKind.KIND_VIDEO || !isCallerVideo(pub, participant)) return;
      this.muted = Boolean(pub.muted);
      this.trackSid = pub.sid;
      void this.consume(new VideoStream(track));
    });
    room.on(RoomEvent.TrackUnsubscribed, (track, pub) => {
      if (track.kind === TrackKind.KIND_VIDEO && pub.sid === this.trackSid) this.reset();
    });
    room.on(RoomEvent.TrackMuted, (pub) => {
      if (pub.kind === TrackKind.KIND_VIDEO && pub.sid === this.trackSid) this.muted = true;
    });
    room.on(RoomEvent.TrackUnmuted, (pub) => {
      if (pub.kind === TrackKind.KIND_VIDEO && pub.sid === this.trackSid) this.muted = false;
    });
  }

  private reset() {
    this.gen++;
    this.trackSid = undefined;
    this.stream = undefined;
    this.latest = undefined;
  }

  private async consume(stream: VideoStream) {
    const gen = ++this.gen;
    this.stream = stream;
    try {
      for await (const ev of stream) {
        if (gen !== this.gen) break; // a newer track replaced this one
        this.latest = { frame: ev.frame, at: Date.now() };
      }
    } catch {
      /* stream closed */
    }
  }

  /** Age of the newest frame in ms (Infinity if none). */
  ageMs(now = Date.now()): number {
    return this.latest ? now - this.latest.at : Infinity;
  }

  async grabFrame(now = Date.now()): Promise<Grab> {
    if (this.muted || !this.latest || now - this.latest.at > MAX_FRAME_AGE_MS) {
      return { ok: false, reason: "camera_off" };
    }
    const rgba = this.latest.frame.convert(VideoBufferType.RGBA);
    const jpeg = await sharp(Buffer.from(rgba.data), {
      raw: { width: rgba.width, height: rgba.height, channels: 4 },
    })
      .resize({ width: FRAME_PX, height: FRAME_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return { ok: true, jpegB64: jpeg.toString("base64") };
  }
}

/** The patient's camera: web app (patient-web-*, camera source) or the Chert bridge's remote-video track. */
export function isCallerVideo(pub: Pick<RemoteTrackPublication, "name" | "source">, participant?: Pick<RemoteParticipant, "identity">): boolean {
  const id = participant?.identity ?? "";
  if (id.startsWith("caregiver-web-")) return false;
  if (id.startsWith("patient-web-")) return pub.source === TrackSource.SOURCE_CAMERA || pub.source === undefined;
  return pub.name === VIDEO_TRACK_NAME || pub.name === "" || pub.name === undefined;
}
