// Downscale an image in the browser before upload. Keeps requests small, stays
// within the AI provider's per-image size limit, and shrinks storage. Always
// outputs JPEG.
export async function resizeImage(
  file: File,
  maxDim = 1568,
  quality = 0.85
): Promise<Blob> {
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(new Error("read failed"));
      fr.readAsDataURL(file);
    });

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new window.Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("decode failed"));
      i.src = dataUrl;
    });

    let width = img.width;
    let height = img.height;
    if (width > maxDim || height > maxDim) {
      const scale = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
    );
    return blob ?? file;
  } catch {
    // If anything about resizing fails, fall back to the original file.
    return file;
  }
}
