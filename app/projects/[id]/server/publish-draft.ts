"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { publishWaiverStagedProject } from "@/app/projects/create/server/create";
import {
  describeProjectWriteError,
  logProjectWriteError,
} from "@/app/projects/create/server/create-support";
import { RECURRENCE_MULTI_DAY_MESSAGE } from "@/lib/projects/recurrence";
import {
  validateProjectTimezone,
  validateRecurrenceRule,
} from "@/lib/projects/schedule-validation";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { createClient } from "@/lib/supabase/server";
import { basicInfoSchema } from "@/schemas/event-form-schema";
import { validateScheduleForPublication } from "@/schemas/project-create-schema";
import type { EventType } from "@/types";

import { canUserManageProject } from "./access-helpers";

export type PublishProjectDraftFailure =
  | "unauthenticated"
  | "forbidden"
  | "not_draft"
  | "invalid_project"
  | "waiver_blocked"
  | "failed";

export type PublishProjectDraftResult =
  | { success: true; projectId: string }
  | { success: false; code: PublishProjectDraftFailure; error: string };

const PUBLISHABLE_CONTENT = basicInfoSchema.pick({
  title: true,
  location: true,
  description: true,
});

const EVENT_TYPES: readonly EventType[] = [
  "oneTime",
  "multiDay",
  "sameDayMultiArea",
];

function isEventType(value: unknown): value is EventType {
  return EVENT_TYPES.some((eventType) => eventType === value);
}

function refuse(
  code: PublishProjectDraftFailure,
  error: string,
): PublishProjectDraftResult {
  return { success: false, code, error };
}

/**
 * Publishes a project row that is still a draft: a duplicated project, or a
 * project whose first publication did not finish.
 *
 * The caller needs the same right `updateProject` asks for, the row has to
 * pass the checks a newly created project passes, and a waiver project still
 * goes through the database's own proof before it becomes visible.
 */
export async function publishProjectDraft(
  projectId: string,
): Promise<PublishProjectDraftResult> {
  "use server";
  try {
    const supabase = await createClient();

    // Authentication and authorization first: a caller without the right to
    // manage this project must not learn whether it exists or what is wrong
    // with it.
    const { user, error: userError } = await getAuthUser();
    if (userError || !user) {
      return refuse(
        "unauthenticated",
        "You must be logged in to publish a project.",
      );
    }

    const { data: project } = await supabase
      .from("projects")
      .select(
        "id, creator_id, organization_id, can_be_managed_by_staff, title, location, description, event_type, schedule, project_timezone, recurrence_rule, waiver_required, workflow_status, visibility",
      )
      .eq("id", projectId)
      .maybeSingle();

    if (
      !project ||
      project.id !== projectId ||
      !(await canUserManageProject(supabase, project, user.id))
    ) {
      return refuse(
        "forbidden",
        "You don't have permission to publish this project.",
      );
    }

    if (project.workflow_status !== "draft") {
      return refuse(
        "not_draft",
        project.workflow_status === "published" ||
          project.workflow_status === null
          ? "This project is already published."
          : "Only a draft project can be published.",
      );
    }

    // The same content, timezone and schedule rules the create form applies.
    const content = PUBLISHABLE_CONTENT.safeParse({
      title: project.title ?? "",
      location: project.location ?? "",
      description: project.description ?? "",
    });
    if (!content.success) {
      return refuse(
        "invalid_project",
        content.error.issues[0]?.message ??
          "Add a title, location and description before publishing.",
      );
    }

    if (!isEventType(project.event_type)) {
      return refuse(
        "invalid_project",
        "This project has no event type. Duplicate it again or create a new project.",
      );
    }

    const timezoneResult = validateProjectTimezone(project.project_timezone);
    if (!timezoneResult.ok) {
      return refuse(
        "invalid_project",
        "Choose a time zone for this project before publishing.",
      );
    }

    const scheduleResult = validateScheduleForPublication(
      project.event_type,
      project.schedule,
      { timeZone: project.project_timezone },
    );
    if (!scheduleResult.ok) {
      return refuse("invalid_project", scheduleResult.error);
    }

    const waiverRequired = project.waiver_required === true;
    if (project.recurrence_rule !== null) {
      const ruleResult = validateRecurrenceRule(project.recurrence_rule);
      if (!ruleResult.ok) {
        return refuse(
          "invalid_project",
          "The repeat schedule is not valid. Review it, save, and publish again.",
        );
      }
      if (project.event_type === "multiDay") {
        return refuse("invalid_project", RECURRENCE_MULTI_DAY_MESSAGE);
      }
    }

    // Public projects need a Trusted Member, exactly as they do on creation
    // and on a visibility change.
    if (project.visibility === "public") {
      const { data: isTrustedMember } = await supabase.rpc(
        "is_trusted_member",
        { p_user: user.id },
      );

      if (isTrustedMember !== true) {
        const { data: tmApp } = await supabase
          .from("trusted_member")
          .select("status")
          .or(`id.eq.${user.id},user_id.eq.${user.id}`)
          .maybeSingle();

        if (tmApp?.status !== true) {
          return refuse(
            "forbidden",
            "Only Trusted Members can publish Public projects. Change the visibility to Unlisted or Organization-only, or apply at /trusted-member.",
          );
        }
      }
    }

    // A published project is stored as "upcoming" until the status job moves
    // it on. A waiver project gets that status while it is still a draft, and
    // is then published by the database once it can prove the waiver. Any
    // other project is published in the same write.
    const { data: published, error: publishError } = await supabase
      .from("projects")
      .update(
        waiverRequired
          ? { status: "upcoming" }
          : { status: "upcoming", workflow_status: "published" },
      )
      .eq("id", projectId)
      .eq("workflow_status", "draft")
      .select("id")
      .maybeSingle();

    if (publishError) {
      logProjectWriteError("Error publishing project draft:", publishError);
      return refuse(
        "failed",
        describeProjectWriteError(publishError) ??
          "The project could not be published. Please try again.",
      );
    }

    if (published?.id !== projectId) {
      return refuse(
        "not_draft",
        "This project changed while it was being published. Refresh the page and try again.",
      );
    }

    if (waiverRequired) {
      const waiverPublication = await publishWaiverStagedProject(projectId);
      if (!waiverPublication.success) {
        return refuse(
          "waiver_blocked",
          waiverPublication.error ??
            "The waiver is not ready, so this project cannot be published yet.",
        );
      }
    }

    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/home");
    if (project.organization_id) {
      revalidatePath(`/organization/${project.organization_id}`);
    }

    return { success: true, projectId };
  } catch (error) {
    logProjectWriteError("Error in publish project draft action:", error);
    return refuse(
      "failed",
      "The project could not be published. Please try again.",
    );
  }
}
