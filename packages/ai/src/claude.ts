/**
 * Claude helper: one forced tool with input_schema → validated JSON (CLAUDE.md rule).
 *
 * The current API rejects forced tool_choice / non-default sampling / disabled thinking on some
 * 5.5 models, so each call degrades through variants until one is accepted (remembered per model):
 *   1. forced tool_choice + low-latency thinking settings
 *   2. tool_choice "auto" + an explicit "call tool X" instruction
 *   3. bare request (no thinking/effort overrides)
 * Never logs prompts, images or responses (patient data).
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

export const CLAUDE_FAST = () => process.env.CLAUDE_FAST ?? "claude-haiku-5-5";
export const CLAUDE_SMART = () => process.env.CLAUDE_SMART ?? "claude-sonnet-5-5";

export const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY);

let _client: Anthropic | undefined;
const client = () => (_client ??= new Anthropic({ maxRetries: 2, timeout: 60_000 }));

export type ImageMime = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export type Part =
  | { type: "text"; text: string }
  | { type: "image"; b64: string; mime?: ImageMime }
  | { type: "image_url"; url: string };

function toContent(parts: Part[]): Anthropic.ContentBlockParam[] {
  return parts.map((p): Anthropic.ContentBlockParam => {
    if (p.type === "text") return { type: "text", text: p.text };
    if (p.type === "image_url") return { type: "image", source: { type: "url", url: p.url } };
    return {
      type: "image",
      source: { type: "base64", media_type: p.mime ?? "image/jpeg", data: stripDataUrl(p.b64) },
    };
  });
}

/** Accept raw base64 or a data: URL. */
export function stripDataUrl(b64: string): string {
  const i = b64.indexOf("base64,");
  return i >= 0 ? b64.slice(i + 7) : b64;
}

/** Sniff the image type from base64 magic bytes (callers rarely know it). */
export function sniffMime(b64: string, fallback: ImageMime = "image/jpeg"): ImageMime {
  const h = stripDataUrl(b64).slice(0, 16);
  if (h.startsWith("/9j/")) return "image/jpeg";
  if (h.startsWith("iVBOR")) return "image/png";
  if (h.startsWith("R0lG")) return "image/gif";
  if (h.startsWith("UklG")) return "image/webp";
  return fallback;
}

type Tier = "fast" | "smart";

export interface ClaudeJsonOpts<S extends z.ZodType> {
  tier: Tier;
  system: string;
  content: Part[];
  schema: S;
  toolName: string;
  toolDescription: string;
  maxTokens: number;
}

const variantByModel = new Map<string, number>();

function variantParams(tier: Tier, variant: number, toolName: string): Record<string, unknown> {
  if (variant === 0) {
    return {
      thinking: tier === "fast" ? { type: "disabled" } : { type: "between_tools" },
      output_config: { effort: tier === "fast" ? "low" : "medium" },
      tool_choice: { type: "tool", name: toolName },
    };
  }
  if (variant === 1) {
    return { output_config: { effort: "low" }, tool_choice: { type: "auto" } };
  }
  return { tool_choice: { type: "auto" } };
}

export async function claudeJson<S extends z.ZodType>(o: ClaudeJsonOpts<S>): Promise<z.infer<S>> {
  const model = o.tier === "fast" ? CLAUDE_FAST() : CLAUDE_SMART();
  const { $schema: _ignored, ...inputSchema } = z.toJSONSchema(o.schema) as Record<string, unknown>;
  void _ignored;
  const tool = {
    name: o.toolName,
    description: o.toolDescription,
    input_schema: inputSchema,
  } as unknown as Anthropic.Tool;

  let variant = variantByModel.get(model) ?? 0;
  for (;;) {
    const forced = variant === 0;
    const system = forced
      ? o.system
      : `${o.system}\n\nRespond ONLY by calling the tool "${o.toolName}" exactly once.`;
    try {
      const params = {
        model,
        max_tokens: o.maxTokens,
        system,
        tools: [tool],
        messages: [{ role: "user", content: toContent(o.content) }],
        ...variantParams(o.tier, variant, o.toolName),
      } as unknown as Anthropic.MessageCreateParamsNonStreaming;
      const res = await client().messages.create(params);
      const block = res.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === o.toolName,
      );
      if (!block) {
        if (variant < 2) {
          variant++;
          continue;
        }
        throw new Error(`Claude did not call tool ${o.toolName} (stop_reason=${res.stop_reason})`);
      }
      variantByModel.set(model, variant);
      return o.schema.parse(block.input);
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError && variant < 2) {
        variant++; // parameter combination rejected by this model — degrade
        continue;
      }
      throw err;
    }
  }
}

/** Fetch an http(s) image and return base64 (used for medication reference photos). */
export async function fetchImageB64(url: string): Promise<{ b64: string; mime: ImageMime } | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
    return { b64, mime: sniffMime(b64) };
  } catch {
    return null;
  }
}
