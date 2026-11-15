import { fileURLToPath } from "node:url";

export const AVATARS = [
  { id: "helen", name: "Helen", mantle: "#829b80", hair: "#573d32", skin: "#dba17d", accent: "#cfad63" },
  { id: "odysseus", name: "Odysseus", mantle: "#346e70", hair: "#514d48", skin: "#cf9876", accent: "#b69c68" },
  { id: "agamemnon", name: "Agamemnon", mantle: "#853f50", hair: "#704b3a", skin: "#d79d7a", accent: "#c6a15d" },
  { id: "cyclops", name: "Cyclops", mantle: "#b7954e", hair: "#50483f", skin: "#dbad85", accent: "#728572" },
] as const;

export type Avatar = (typeof AVATARS)[number];
export type AvatarId = Avatar["id"];
export type AvatarProvider = "illustrated" | "lemonslice" | "off";

export function findAvatar(id: unknown): Avatar | undefined {
  return AVATARS.find((avatar) => avatar.id === id);
}

/** Familiar per-patient default; explicit demo randomization never changes the care prompt. */
export function selectAvatar(patientId: string, requested?: unknown, configured?: string, random = Math.random): Avatar {
  const override = findAvatar(requested);
  if (override) return override;
  if (configured === "random") {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("Avatar random value must be in [0, 1)");
    return AVATARS[Math.floor(value * AVATARS.length)]!;
  }
  if (configured && configured !== "stable") {
    const fixed = findAvatar(configured);
    if (!fixed) throw new Error("PAL_AVATAR must be stable, random, helen, odysseus, agamemnon, or cyclops");
    return fixed;
  }
  let hash = 2166136261;
  for (const char of patientId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return AVATARS[(hash >>> 0) % AVATARS.length]!;
}

export function avatarProvider(value = "illustrated"): AvatarProvider {
  if (value === "illustrated" || value === "lemonslice" || value === "off") return value;
  throw new Error("PAL_AVATAR_PROVIDER must be illustrated, lemonslice, or off");
}

export function portraitPath(avatar: Avatar): string {
  // Works in src/avatars and compiled dist/avatars. Keep assets beside both folders.
  return fileURLToPath(new URL(`../../assets/avatars/${avatar.id}.png`, import.meta.url));
}
