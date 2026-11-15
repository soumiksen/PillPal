import { avatarProvider } from "../src/avatars/catalog.js";

/** A dedicated mock-API call, even if the shell contains production settings. */
export function avatarCallEnvironment(source: NodeJS.ProcessEnv, testAgentName: string): NodeJS.ProcessEnv {
  const provider = avatarProvider(source.PAL_AVATAR_PROVIDER);
  const missing = ["GOOGLE_API_KEY"].filter(key => !source[key]?.trim());
  const livekitKeys = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"];
  const hasCloud = livekitKeys.some(key => source[key]?.trim());
  if (hasCloud || provider === "lemonslice") missing.push(...livekitKeys.filter(key => !source[key]?.trim()));
  if (provider === "lemonslice" && !source.LEMONSLICE_API_KEY?.trim()) missing.push("LEMONSLICE_API_KEY");
  if (missing.length) throw new Error(`Set these variables in .env.avatar-test: ${missing.join(", ")}`);

  const url = source.LIVEKIT_URL || "ws://localhost:7880";
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("LIVEKIT_URL must be a valid ws:// or wss:// URL"); }
  if (!["ws:", "wss:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("LIVEKIT_URL must use ws:// or wss:// without embedded credentials");
  }
  if (provider === "lemonslice" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    throw new Error("Hosted portraits need a LiveKit URL reachable by LemonSlice; use a LiveKit Cloud test project");
  }
  const port = Number(source.LOCAL_PORT || 8788);
  const agentPort = Number(source.AGENT_PORT || 18081);
  if (![port, agentPort].every(p => Number.isInteger(p) && p >= 1024 && p <= 65535) || port === agentPort) {
    throw new Error("LOCAL_PORT and AGENT_PORT must be different integer ports between 1024 and 65535");
  }
  return {
    ...source,
    LIVEKIT_URL: url,
    LIVEKIT_API_KEY: source.LIVEKIT_API_KEY || "devkey",
    LIVEKIT_API_SECRET: source.LIVEKIT_API_SECRET || "secret",
    LOCAL_PORT: String(port),
    AGENT_PORT: String(agentPort),
    API_URL: `http://127.0.0.1:${port}`,
    AGENT_NAME: testAgentName,
    PATIENT_ID: "00000000-0000-4000-8000-000000000001",
    PAL_AVATAR_PROVIDER: provider,
    GREETING_DELAY_MS: "800",
  };
}
