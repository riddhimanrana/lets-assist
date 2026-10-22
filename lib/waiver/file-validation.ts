import "server-only";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

/** FileReader emits canonical base64. Refuse invalid encodings before decoding. */
export function parseWaiverDataUrl(value: string): {
  contentType: string;
  buffer: Buffer;
  size: number;
} | null {
  if (typeof value !== "string") return null;
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (!match || match[2].length % 4 !== 0) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.toString("base64") !== match[2] || !buffer.length) return null;
  return { contentType: match[1], buffer, size: buffer.length };
}

/** Decode the actual document, keeping the original immutable evidence bytes. */
export async function waiverFileProblem(
  bytes: Buffer,
  contentType: string,
): Promise<"unreadable" | "encrypted" | null> {
  try {
    if (contentType === "application/pdf") {
      if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-")
        return "unreadable";
      const pdf = await PDFDocument.load(bytes, {
        ignoreEncryption: true,
        updateMetadata: false,
      });
      if (pdf.isEncrypted) return "encrypted";
      return pdf.getPageCount() > 0 ? null : "unreadable";
    }
    const expected =
      contentType === "image/png"
        ? "png"
        : contentType === "image/jpeg" || contentType === "image/jpg"
          ? "jpeg"
          : null;
    if (!expected) return "unreadable";
    // Current phone cameras save 24 to 50 megapixel photos of a signed page.
    const image = sharp(bytes, {
      limitInputPixels: 50_000_000,
      failOn: "error",
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== expected ||
      !metadata.width ||
      !metadata.height ||
      (metadata.pages ?? 1) !== 1
    )
      return "unreadable";
    // metadata alone does not decode truncated image data.
    await image.raw().toBuffer();
    return null;
  } catch {
    // Parser/provider errors may contain file contents; return only a fixed code.
    return "unreadable";
  }
}
