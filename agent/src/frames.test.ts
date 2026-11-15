import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { ParticipantKind, RoomEvent, TrackKind, type Room } from "@livekit/rtc-node";
import { FrameGrabber, isCallerVideo, VIDEO_TRACK_NAME } from "./frames.js";

test("avatar tracks never enter patient vision, even with an empty track name", () => {
  assert.equal(isCallerVideo(VIDEO_TRACK_NAME, ParticipantKind.STANDARD), true);
  assert.equal(isCallerVideo("", ParticipantKind.STANDARD), true);
  assert.equal(isCallerVideo("", ParticipantKind.AGENT), false);
  assert.equal(isCallerVideo(VIDEO_TRACK_NAME, ParticipantKind.AGENT), false);
  assert.equal(isCallerVideo("pal-avatar-video", ParticipantKind.STANDARD), false);
});

test("avatar mute events cannot change the patient camera state", () => {
  const room = new EventEmitter();
  const grabber = new FrameGrabber();
  grabber.attach(room as unknown as Room);
  // Observe state through a tiny test seam; no native camera or patient frames needed.
  const state = grabber as unknown as { muted: boolean; gen: number };
  const pub = { kind: TrackKind.KIND_VIDEO, name: VIDEO_TRACK_NAME };
  const caller = { kind: ParticipantKind.STANDARD };
  const avatar = { kind: ParticipantKind.AGENT };
  room.emit(RoomEvent.TrackMuted, pub, caller);
  assert.equal(state.muted, true);
  room.emit(RoomEvent.TrackUnmuted, pub, avatar);
  assert.equal(state.muted, true);
  room.emit(RoomEvent.TrackUnmuted, pub, caller);
  assert.equal(state.muted, false);
  const generation = state.gen;
  room.emit(RoomEvent.TrackUnsubscribed, { kind: TrackKind.KIND_VIDEO }, pub, avatar);
  assert.equal(state.gen, generation);
  room.emit(RoomEvent.TrackUnsubscribed, { kind: TrackKind.KIND_VIDEO }, pub, caller);
  assert.equal(state.gen, generation + 1);
});
