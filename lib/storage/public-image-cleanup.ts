import "server-only";
import { getAdminClient } from "@/lib/supabase/admin";
import { ownedPublicImagePath, type PublicImageBucket } from "./public-image";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type PublicImageCleanupResult = {
  claimed: number;
  deleted: number;
  retained: number;
  retryable: number;
  failed: number;
};
type Claim =
  | { id: string; retained: true }
  | {
      id: string;
      retained: false;
      claim_token: string;
      bucket_id: PublicImageBucket;
      object_name: string;
    };
export type PublicImageCleanupDependencies = {
  claim: () => Promise<unknown>;
  remove: (bucket: PublicImageBucket, path: string) => Promise<boolean>;
  finish: (id: string, token: string, removed: boolean) => Promise<boolean>;
  now: () => number;
};

function parseClaim(value: unknown): Claim | null {
  if (!Array.isArray(value) || value.length > 1)
    throw new Error("Invalid cleanup claim");
  if (!value.length) return null;
  const row = value[0] as Partial<Claim>;
  if (!row || typeof row.id !== "string" || !UUID.test(row.id))
    throw new Error("Invalid cleanup claim");
  if (row.retained === true) return { id: row.id, retained: true };
  if (
    row.retained !== false ||
    typeof row.claim_token !== "string" ||
    !UUID.test(row.claim_token) ||
    (row.bucket_id !== "avatars" && row.bucket_id !== "organization-logos") ||
    typeof row.object_name !== "string"
  )
    throw new Error("Invalid cleanup claim");
  const base = `https://storage.invalid/storage/v1/object/public/${row.bucket_id}/`;
  if (
    ownedPublicImagePath(
      base + row.object_name,
      base,
      row.bucket_id,
      row.object_name.slice(0, 36),
    ) !== row.object_name
  )
    throw new Error("Invalid cleanup path");
  return row as Claim;
}

function productionDependencies(): PublicImageCleanupDependencies {
  const admin = getAdminClient({ timeoutMs: 8_000 });
  return {
    now: Date.now,
    async claim() {
      const { data, error } = await admin
        .rpc("claim_public_image_cleanup", { p_limit: 1 })
        .abortSignal(AbortSignal.timeout(2_000));
      if (error) throw new Error("Image cleanup claim unavailable");
      return data;
    },
    async remove(bucket, path) {
      const { error } = await admin.storage.from(bucket).remove([path]);
      return !error;
    },
    async finish(id, token, removed) {
      const { data, error } = await admin
        .rpc("finish_public_image_cleanup", {
          p_id: id,
          p_claim: token,
          p_removed: removed,
        })
        .abortSignal(AbortSignal.timeout(2_000));
      if (error || typeof data !== "boolean")
        throw new Error("Image cleanup acknowledgement unavailable");
      return data;
    },
  };
}

export async function runPublicImageCleanup(
  dependencies: PublicImageCleanupDependencies = productionDependencies(),
): Promise<PublicImageCleanupResult> {
  const result = {
    claimed: 0,
    deleted: 0,
    retained: 0,
    retryable: 0,
    failed: 0,
  };
  const deadline = dependencies.now() + 25_000;
  for (
    let index = 0;
    index < 10 && dependencies.now() + 12_000 <= deadline;
    index++
  ) {
    let row: Claim | null;
    try {
      row = parseClaim(await dependencies.claim());
    } catch {
      throw new Error("Image cleanup claim could not be confirmed");
    }
    if (!row) break;
    result.claimed++;
    if (row.retained) {
      result.retained++;
      continue;
    }
    let removed = false;
    try {
      removed = await dependencies.remove(row.bucket_id, row.object_name);
    } catch {
      /* The durable claim remains retryable. */
    }
    try {
      const complete = await dependencies.finish(
        row.id,
        row.claim_token,
        removed,
      );
      if (complete) result.deleted++;
      else result.retryable++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
