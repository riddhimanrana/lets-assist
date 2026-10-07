import "server-only";
import {
  ownedPublicImagePath,
  publicImageKey,
  type PublicImageBucket,
} from "./public-image";

type StorageBucket = {
  upload(
    path: string,
    body: Buffer,
    options: { contentType: string; upsert: boolean; cacheControl: string },
  ): PromiseLike<{ error: unknown }>;
  remove(paths: string[]): PromiseLike<{ error: unknown }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
};
export type ImageReferenceCommit = "committed" | "refused" | "unknown";

/** Publish the reference before deleting the predecessor. Never undo an unknown commit. */
export async function replacePublicImage({
  bucket,
  ownerId,
  previousUrl,
  image,
  storage,
  commit,
}: {
  bucket: PublicImageBucket;
  ownerId: string;
  previousUrl: string | null;
  image: Buffer | null;
  storage: StorageBucket;
  commit: (url: string | null) => Promise<ImageReferenceCommit>;
}): Promise<
  | { success: true; url: string | null; cleanupPending: boolean }
  | { success: false; error: string; cleanupPending: boolean }
> {
  const key = image ? publicImageKey(bucket, ownerId) : null;
  const url = key ? storage.getPublicUrl(key).data.publicUrl : null;
  if (key && image) {
    try {
      const upload = await storage.upload(key, image, {
        contentType: "image/webp",
        upsert: false,
        cacheControl: "31536000",
      });
      if (upload.error)
        return {
          success: false,
          error:
            "Image upload could not be confirmed. Your existing image was kept.",
          cleanupPending: true,
        };
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
    let cleanupPending = Boolean(key);
    if (result === "refused" && key) {
      try {
        cleanupPending = Boolean((await storage.remove([key])).error);
      } catch {
        /* Retain the candidate for cleanup. */
      }
    }
    return {
      success: false,
      error:
        result === "refused"
          ? "The image changed while you were editing. Refresh before trying again."
          : "The image update could not be confirmed. Refresh before trying again.",
      cleanupPending,
    };
  }
  const oldPath = ownedPublicImagePath(
    previousUrl,
    storage.getPublicUrl("").data.publicUrl,
    bucket,
    ownerId,
  );
  if (oldPath && oldPath !== key) {
    try {
      const removed = await storage.remove([oldPath]);
      return { success: true, url, cleanupPending: Boolean(removed.error) };
    } catch {
      return { success: true, url, cleanupPending: true };
    }
  }
  return {
    success: true,
    url,
    cleanupPending: Boolean(previousUrl && previousUrl !== url && !oldPath),
  };
}
