"use client";

/**
 * Canvas-based downscale for paper sheet photos before upload. No external
 * dependency (the same approach as components/shared/ImageCropper.tsx).
 *
 * Phone photos carry EXIF orientation. Drawing a raw HTMLImageElement to a
 * canvas and re-encoding strips EXIF and hands the model a sideways sheet,
 * so decoding goes through createImageBitmap with
 * imageOrientation: "from-image", which bakes the rotation into the pixels.
 *
 * 2000px on the long edge keeps roughly 8-10px of cap height for handwriting
 * on a US-Letter sheet — enough for the model — at ~400KB-1MB instead of the
 * 4-8MB straight off a camera.
 */

export interface DownscaledImage {
  file: File;
  width: number;
  height: number;
  originalBytes: number;
}

const DEFAULT_MAX_EDGE = 2000;
const DEFAULT_QUALITY = 0.82;

async function decodeWithOrientation(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through to the HTMLImageElement path below.
    }
  }

  // Fallback (old WebKit): orientation may be lost; the review step still
  // shows the photo, so a sideways sheet is visible and re-takeable.
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image_decode_failed"));
    };
    image.src = url;
  });
}

async function encodeCanvas(
  source: ImageBitmap | HTMLImageElement,
  width: number,
  height: number,
  quality: number,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);
    return canvas.convertToBlob({ type: "image/jpeg", quality });
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
}

export async function downscaleImageFile(
  file: File,
  options?: { maxEdge?: number; quality?: number },
): Promise<DownscaledImage> {
  const maxEdge = options?.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = options?.quality ?? DEFAULT_QUALITY;

  const source = await decodeWithOrientation(file);
  try {
    const sourceWidth =
      "naturalWidth" in source ? source.naturalWidth : source.width;
    const sourceHeight =
      "naturalHeight" in source ? source.naturalHeight : source.height;
    if (!sourceWidth || !sourceHeight) {
      throw new Error("image_decode_failed");
    }

    // Never upscale.
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const blob = await encodeCanvas(source, width, height, quality);

    // If re-encoding did not actually shrink the file, keep the original.
    if (!blob || blob.size >= file.size) {
      return {
        file,
        width: sourceWidth,
        height: sourceHeight,
        originalBytes: file.size,
      };
    }

    return {
      file: new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
        type: "image/jpeg",
        lastModified: file.lastModified,
      }),
      width,
      height,
      originalBytes: file.size,
    };
  } finally {
    if ("close" in source) {
      source.close();
    }
  }
}

/**
 * Sequential on purpose: ten simultaneous 12MP decodes will exhaust memory
 * on a mid-range phone. onProgress fires before each file starts.
 */
export async function downscaleImageFiles(
  files: File[],
  options?: {
    maxEdge?: number;
    quality?: number;
    onProgress?: (index: number, total: number) => void;
  },
): Promise<DownscaledImage[]> {
  const results: DownscaledImage[] = [];
  for (let index = 0; index < files.length; index++) {
    options?.onProgress?.(index, files.length);
    results.push(await downscaleImageFile(files[index], options));
  }
  return results;
}
