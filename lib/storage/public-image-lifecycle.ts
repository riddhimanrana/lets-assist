import "server-only";
import { getAdminClient } from "@/lib/supabase/admin";
import type { PublicImageBucket } from "./public-image";

export type PublicImageReservation = {
  actorId: string;
  bucket: PublicImageBucket;
  ownerId: string;
  previousUrl: string | null;
  previousPath: string | null;
  candidatePath: string | null;
};

export async function reservePublicImageCleanup(input: PublicImageReservation) {
  const { error } = await getAdminClient({ timeoutMs: 5_000 }).rpc(
    "reserve_public_image_cleanup",
    {
      p_actor: input.actorId,
      p_bucket: input.bucket,
      p_owner: input.ownerId,
      p_previous_url: input.previousUrl,
      p_previous_path: input.previousPath,
      p_candidate_path: input.candidatePath,
    },
  );
  if (error) throw new Error("Image cleanup could not be reserved");
}
