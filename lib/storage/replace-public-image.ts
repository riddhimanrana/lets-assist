import "server-only";
import {
  ownedPublicImagePath,
  publicImageKey,
  type PublicImageBucket,
} from "./public-image";
import {
  reservePublicImageCleanup,
  type PublicImageReservation,
} from "./public-image-lifecycle";

type StorageBucket = {
  upload(
    path: string,
    body: Buffer,
    options: { contentType: string; upsert: boolean; cacheControl: string },
  ): PromiseLike<{ error: unknown }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
};
export type ImageReferenceCommit = "committed" | "refused" | "unknown";

export async function replacePublicImage({
  actorId,
  bucket,
  ownerId,
  previousUrl,
  image,
  storage,
  commit,
  reserve = reservePublicImageCleanup,
}: {
  actorId: string;
  bucket: PublicImageBucket;
  ownerId: string;
  previousUrl: string | null;
  image: Buffer | null;
  storage: StorageBucket;
  commit: (url: string | null) => Promise<ImageReferenceCommit>;
  reserve?: (input: PublicImageReservation) => Promise<void>;
}): Promise<
  | { success: true; url: string | null; cleanupPending: boolean }
  | { success: false; error: string; cleanupPending: boolean }
> {
  const key = image ? publicImageKey(bucket, ownerId) : null;
  const url = key ? storage.getPublicUrl(key).data.publicUrl : null;
  const oldPath = ownedPublicImagePath(
    previousUrl,
    storage.getPublicUrl("").data.publicUrl,
    bucket,
    ownerId,
  );
  try {
    await reserve({
      actorId,
      bucket,
      ownerId,
      previousUrl,
      previousPath: oldPath,
      candidatePath: key,
    });
  } catch {
    return {
      success: false,
      error:
        "The image update could not be prepared. Your existing image was kept. Try again.",
      cleanupPending: false,
    };
  }
  if (key && image) {
    try {
      const upload = await storage.upload(key, image, {
        contentType: "image/webp",
        upsert: false,
        cacheControl: "31536000",
      });
      if (upload.error) throw new Error("Upload unconfirmed");
    } catch {
      return {
        success: false,
        error:
          "Image upload could not be confirmed. Your existing image was kept.",
        cleanupPending: true,
      };
    }
  }
  let result: ImageReferenceCommit;
  try {
    result = await commit(url);
  } catch {
    result = "unknown";
  }
  if (result !== "committed") {
    return {
      success: false,
      error:
        result === "refused"
          ? "The image changed while you were editing. Refresh before trying again."
          : "The image update could not be confirmed. Refresh before trying again.",
      cleanupPending: Boolean(key || oldPath),
    };
  }
  return { success: true, url, cleanupPending: Boolean(oldPath) };
}
