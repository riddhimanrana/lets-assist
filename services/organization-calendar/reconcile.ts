import "server-only";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/admin";
import { createPersonalCalendarEventRemover } from "@/services/personal-calendar/provider";
import { writeOrganizationCalendarEvent } from "./provider";

export type OrganizationCalendarProjection = {
  source_kind:
    | "project_schedule"
    | "csf_opportunity"
    | "csf_meeting_session"
    | "csf_deadline";
  source_id: string;
  occurrence_key: string;
  event: object;
};
const receiptSchema = z.object({
  id: z.string().uuid(),
  calendar_id: z.string(),
  event_id: z.string(),
  phase: z.enum(["pending_create", "pending_update", "pending_remove"]),
  event_payload: z.record(z.string(), z.unknown()).nullable(),
});
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;
type Dependencies = {
  rpc: Rpc;
  write: typeof writeOrganizationCalendarEvent;
  remove: ReturnType<typeof createPersonalCalendarEventRemover>;
  now: () => number;
};
export type DurableOrganizationCalendarSyncResult =
  | {
      success: true;
      createdCount: number;
      updatedCount: number;
      removedCount: number;
    }
  | { success: false; error: string };

export async function reconcileOrganizationCalendar(
  options: {
    userId: string;
    organizationId: string;
    calendarId: string;
    accessToken: string;
    sourceKinds: OrganizationCalendarProjection["source_kind"][];
    load: () => Promise<OrganizationCalendarProjection[]>;
  },
  dependencies?: Dependencies,
): Promise<DurableOrganizationCalendarSyncResult> {
  const deps = dependencies ?? {
    rpc: (name, args) => getAdminClient().rpc(name, args),
    write: writeOrganizationCalendarEvent,
    remove: createPersonalCalendarEventRemover(),
    now: Date.now,
  };
  const actor = {
    p_actor: options.userId,
    p_organization: options.organizationId,
  };
  let claim: string | null = null;
  const advance = async (step: string, payload: object = {}) => {
    const result = await deps.rpc("advance_organization_calendar_sync", {
      ...actor,
      p_claim: claim,
      p_step: step,
      p_payload: payload,
    });
    if (result.error)
      throw new Error(
        "Calendar progress could not be saved. Retry to continue.",
      );
    return result.data;
  };
  try {
    const result = await deps.rpc("claim_organization_calendar_sync", {
      ...actor,
      p_calendar_id: options.calendarId,
    });
    const parsedClaim = z.string().uuid().safeParse(result.data);
    if (result.error || !parsedClaim.success)
      return {
        success: false,
        error:
          "Calendar sync is unavailable or already running. Retry shortly.",
      };
    claim = parsedClaim.data;
    const projections = await options.load();
    await advance("plan", {
      source_kinds: options.sourceKinds,
      events: projections,
    });
    const started = deps.now();
    const counts = { createdCount: 0, updatedCount: 0, removedCount: 0 };
    for (let processed = 0; processed < 200; processed += 1) {
      if (deps.now() - started >= 25_000)
        throw new Error(
          "Calendar progress is saved. Retry to continue the remaining events.",
        );
      const next = await advance("next");
      if (next === null) {
        await advance("finish");
        claim = null;
        return { success: true, ...counts };
      }
      const parsed = receiptSchema.safeParse(next);
      if (!parsed.success)
        throw new Error(
          "Calendar progress is invalid. No provider request was sent.",
        );
      const receipt = parsed.data;
      const transition = { receipt_id: receipt.id, event_id: receipt.event_id };
      if (receipt.phase === "pending_remove") {
        if (
          !(await deps.remove(
            options.accessToken,
            receipt.calendar_id,
            receipt.event_id,
          ))
        )
          throw new Error(
            "Calendar removal was not confirmed. Retry to continue.",
          );
        await advance("complete", transition);
        counts.removedCount += 1;
        continue;
      }
      if (!receipt.event_payload)
        throw new Error("Calendar event plan is missing.");
      const written = await deps.write({
        accessToken: options.accessToken,
        calendarId: receipt.calendar_id,
        eventId: receipt.event_id,
        receiptId: receipt.id,
        create: receipt.phase === "pending_create",
        event: receipt.event_payload,
        beforeWrite: () => advance("renew"),
      });
      if (written === "unconfirmed")
        throw new Error(
          "Calendar event delivery was not confirmed. Retry to continue.",
        );
      await advance(written === "missing" ? "missing" : "complete", transition);
      if (written === "confirmed") {
        if (receipt.phase === "pending_create") counts.createdCount += 1;
        else counts.updatedCount += 1;
      }
    }
    throw new Error(
      "Calendar progress is saved. Retry to continue the remaining events.",
    );
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Calendar sync failed. Retry to continue.",
    };
  } finally {
    if (claim) {
      try {
        await advance("release");
      } catch {
        /* The saved lease expires for the next retry. */
      }
    }
  }
}
