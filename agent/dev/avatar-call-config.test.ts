import assert from "node:assert/strict";
import { test } from "node:test";
import { avatarCallEnvironment } from "./avatar-call-config.js";

test("test calls always use the fictional patient, mock API, and a separate agent name", () => {
  const env = avatarCallEnvironment({ GOOGLE_API_KEY: "test-key", API_URL: "https://production.invalid", AGENT_NAME: "production-agent", PATIENT_ID: "real-patient" }, "test-agent");
  assert.equal(env.API_URL, "http://127.0.0.1:8788");
  assert.equal(env.PATIENT_ID, "00000000-0000-4000-8000-000000000001");
  assert.equal(env.AGENT_NAME, "test-agent");
  assert.equal(env.LIVEKIT_URL, "ws://localhost:7880");
});

test("hosted portraits require complete credentials and reject localhost LiveKit", () => {
  assert.throws(() => avatarCallEnvironment({ PAL_AVATAR_PROVIDER: "lemonslice" }, "test"), /GOOGLE_API_KEY.*LIVEKIT_URL.*LEMONSLICE_API_KEY/);
  const cloud = { GOOGLE_API_KEY: "test-google", LEMONSLICE_API_KEY: "test-lemon", PAL_AVATAR_PROVIDER: "lemonslice", LIVEKIT_URL: "wss://test.invalid", LIVEKIT_API_KEY: "test-id", LIVEKIT_API_SECRET: "test-secret" };
  assert.equal(avatarCallEnvironment(cloud, "test").PAL_AVATAR_PROVIDER, "lemonslice");
  assert.throws(() => avatarCallEnvironment({ ...cloud, LIVEKIT_URL: "ws://localhost:7880" }, "test"), /reachable/);
  assert.throws(() => avatarCallEnvironment({ ...cloud, LIVEKIT_API_SECRET: "" }, "test"), /LIVEKIT_API_SECRET/);
  assert.throws(() => avatarCallEnvironment({ ...cloud, LOCAL_PORT: "18081" }, "test"), /different/);
  assert.throws(() => avatarCallEnvironment({ ...cloud, LIVEKIT_URL: "https://test.invalid" }, "test"), /ws:\/\//);
});
