// Server-only helper for Google Imagen (via the Gemini API key). Generates
// images and returns their raw bytes. Never import this into client code.
const IMAGEN_MODEL = "imagen-4.0-generate-001";

export const googleConfigured = !!(
  process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
);

type GeneratedImage = { buffer: Buffer; mimeType: string };

export async function generateImages(
  prompt: string,
  count: number
): Promise<GeneratedImage[]> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY.");

  const sampleCount = Math.max(1, Math.min(4, count));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:predict`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount,
          aspectRatio: "1:1",
          personGeneration: "allow_adult",
        },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Imagen request failed (${res.status}): ${text.slice(0, 300)}`
    );
  }

  const json = (await res.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
  };
  const preds = json.predictions ?? [];
  const out: GeneratedImage[] = [];
  for (const p of preds) {
    if (!p.bytesBase64Encoded) continue;
    out.push({
      buffer: Buffer.from(p.bytesBase64Encoded, "base64"),
      mimeType: p.mimeType || "image/png",
    });
  }
  if (out.length === 0) {
    throw new Error(
      "Imagen returned no images (the prompt may have been blocked)."
    );
  }
  return out;
}
