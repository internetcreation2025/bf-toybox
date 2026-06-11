import Anthropic from "@anthropic-ai/sdk";

// Server-only Claude client. ANTHROPIC_API_KEY must never reach the browser.
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const CLAUDE_MODEL = "claude-opus-4-8";

export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export function normaliseImageType(t: string | undefined): SupportedImageType {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(t ?? "")
    ? (t as SupportedImageType)
    : "image/jpeg";
}
