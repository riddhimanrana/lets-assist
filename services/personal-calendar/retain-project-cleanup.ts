import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { personalCalendarReceiptSchema } from "./reconcile";

/**
 * After authorized deletion has claimed the project assets, preserve its creator's
 * removal receipt before deleting the source row. The existing SQL derives
 * ownership from that row or an exact existing receipt. No provider or OAuth
 * work runs here; the creator can finish removal from calendar settings.
 */
export async function retainProjectCalendarCleanup(input: {
  userId: string;
  projectId: string;
  expectedEventId: string;
}): Promise<void> {
  const admin = getAdminClient();
  const failure = () => new Error("Project calendar cleanup was not retained.");
  function parse(data: unknown) {
    const result = personalCalendarReceiptSchema.safeParse(data);
    if (
      !result.success ||
      result.data.source_kind !== "project" ||
      result.data.source_id !== input.projectId ||
      result.data.project_id !== input.projectId ||
      result.data.user_id !== input.userId ||
      (result.data.events[0]?.id ?? result.data.legacy_event_id) !==
        input.expectedEventId ||
      !["removing", "removed"].includes(result.data.phase)
    )
      throw failure();
    return result.data;
  }

  const claim = await admin.rpc("claim_personal_calendar_sync", {
    p_actor_user_id: input.userId,
    p_source_kind: "project",
    p_source_id: input.projectId,
    p_operation: "remove",
    p_schedule_id: null,
    p_expected_event_id: input.expectedEventId,
  });
  if (claim.error) throw failure();
  const receipt = parse(claim.data);
  if (receipt.phase === "removed") return;
  if (!receipt.claim_token) throw failure();

  const release = await admin.rpc("advance_personal_calendar_sync", {
    p_actor_user_id: input.userId,
    p_source_kind: "project",
    p_source_id: input.projectId,
    p_claim_token: receipt.claim_token,
    p_step: "release",
    p_payload: {},
  });
  if (release.error) throw failure();
  const retained = parse(release.data);
  if (
    retained.generation !== receipt.generation ||
    retained.phase !== "removing" ||
    retained.claim_token !== null ||
    retained.calendar_id !== receipt.calendar_id ||
    retained.legacy_event_id !== receipt.legacy_event_id ||
    JSON.stringify(retained.events) !== JSON.stringify(receipt.events) ||
    JSON.stringify(retained.confirmed_event_ids) !==
      JSON.stringify(receipt.confirmed_event_ids)
  )
    throw failure();
}
