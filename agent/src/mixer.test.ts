import { test } from "node:test";
import assert from "node:assert/strict";
import { SampleQueue, mixFrame } from "./mixer.js";
import { isCallerVideo } from "./frames.js";
import { TrackSource } from "@livekit/rtc-node";

test("mixer sums primed sources, clips, and adds silence for a source that ran dry", () => {
  const a = new SampleQueue();
  const b = new SampleQueue();
  a.push(new Int16Array(1440).fill(20000)); // 60 ms → primed
  b.push(new Int16Array(1440).fill(20000));
  const out = mixFrame([a, b], 480);
  assert.equal(out[0], 32767); // clipped
  const quiet = new SampleQueue();
  quiet.push(new Int16Array(100).fill(5)); // not primed yet → contributes nothing
  assert.equal(mixFrame([quiet], 480)[0], 0);
});

test("vision uses the patient's camera, never the caregiver's", () => {
  assert.equal(isCallerVideo({ name: "", source: TrackSource.SOURCE_CAMERA }, { identity: "patient-web-1" }), true);
  assert.equal(isCallerVideo({ name: "", source: TrackSource.SOURCE_CAMERA }, { identity: "caregiver-web-1" }), false);
  assert.equal(isCallerVideo({ name: "facetime-remote-video", source: TrackSource.SOURCE_CAMERA }, { identity: "chert-bridge-x" }), true);
});
