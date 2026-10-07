import "server-only";
import sharp from "sharp";
import { randomUUID } from "node:crypto";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type PublicImageBucket = "avatars" | "organization-logos";

/** Decode the actual raster, cap resource use, and omit input metadata. */
export async function preparePublicImage(value: string): Promise<Buffer> {
  if (value.length > Math.ceil(MAX_BYTES / 3) * 4 + 64)
    throw new Error("Image exceeds the 5 MB limit");
  const match =
    /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value,
    );
  if (!match) throw new Error("Choose a JPEG, PNG, or WebP image");
  const input = Buffer.from(match[2], "base64");
  if (
    !input.length ||
    input.length > MAX_BYTES ||
    input.toString("base64") !== match[2]
  )
    throw new Error("Invalid image encoding");
  try {
    const image = sharp(input, {
      limitInputPixels: MAX_PIXELS,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    const expected = match[1] === "jpg" ? "jpeg" : match[1];
    if (
      metadata.format !== expected ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 8192 ||
      metadata.height > 8192 ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error("Unsupported image");
    const output = await image
      .rotate()
      .resize({
        width: 1024,
        height: 1024,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();
    if (output.length > MAX_BYTES) throw new Error("Image too large");
    return output;
  } catch {
    throw new Error(
      "Image could not be decoded. Use a non-animated JPEG, PNG, or WebP with at most 16 million pixels.",
    );
  }
}

/** Preserve the existing bucket RLS prefix, with a unique immutable suffix. */
export function publicImageKey(bucket: PublicImageBucket, ownerId: string) {
  if (!UUID.test(ownerId)) throw new Error("Invalid image owner");
  return bucket === "avatars"
    ? `${ownerId}-${randomUUID()}.webp`
    : `${ownerId}.${randomUUID()}.webp`;
}

/** Only delete an exact object belonging to this owner on this storage origin. */
export function ownedPublicImagePath(
  value: string | null | undefined,
  bucketBaseUrl: string,
  bucket: PublicImageBucket,
  ownerId: string,
): string | null {
  if (!value || !UUID.test(ownerId)) return null;
  try {
    const url = new URL(value);
    const base = new URL(bucketBaseUrl);
    const prefix = `/storage/v1/object/public/${bucket}/`;
    if (
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      !url.pathname.startsWith(prefix)
    )
      return null;
    const objectPath = decodeURIComponent(url.pathname.slice(prefix.length));
    const separator = bucket === "avatars" ? "-" : ".";
    if (
      !objectPath.startsWith(`${ownerId}${separator}`) ||
      !/^[a-fA-F0-9.-]+\.(?:jpg|jpeg|png|webp)$/i.test(objectPath)
    )
      return null;
    return objectPath;
  } catch {
    return null;
  }
}
