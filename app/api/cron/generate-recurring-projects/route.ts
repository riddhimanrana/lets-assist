import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { addDays, addWeeks, addMonths, addYears, format, isAfter, isBefore, parseISO } from "date-fns";

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getAllowedCronTokens(): string[] {
  return [
    process.env.CRON_SECRET,
    process.env.RECURRING_PROJECTS_SECRET_TOKEN,
  ].filter((value): value is string => Boolean(value));
}

function authorizeCronRequest(
  request: NextRequest
): { ok: true } | { ok: false; response: NextResponse } {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const allowedTokens = getAllowedCronTokens();

  if (allowedTokens.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Cron auth not configured" },
        { status: 500 }
      ),
    };
  }

  if (!token || !allowedTokens.includes(token)) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { ok: true };
}

interface RecurrenceRule {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  end_type: "never" | "on_date" | "after_occurrences";
  end_date?: string | null;
  end_occurrences?: number | null;
  weekdays?: string[];
}

interface Project {
  id: string;
  creator_id: string;
  title: string;
  description: string;
  location: string;
  location_data: unknown;
  event_type: string;
  schedule: Record<string, unknown>;
  verification_method: string;
  require_login: boolean;
  enable_volunteer_comments: boolean;
  show_attendees_publicly: boolean;
  organization_id: string | null;
  visibility: string;
  project_timezone: string;
  restrict_to_org_domains: boolean;
  recurrence_rule: RecurrenceRule;
  recurrence_sequence: number | null;
}

function calculateNextDate(
  currentDate: Date,
  rule: RecurrenceRule
): Date | null {
  const interval = rule.interval || 1;

  switch (rule.frequency) {
    case "daily":
      return addDays(currentDate, interval);
    case "weekly":
      if (rule.weekdays && rule.weekdays.length > 0) {
        return findNextWeekday(currentDate, rule.weekdays, interval);
      }
      return addWeeks(currentDate, interval);
    case "monthly":
      return addMonths(currentDate, interval);
    case "yearly":
      return addYears(currentDate, interval);
    default:
      return null;
  }
}

function findNextWeekday(
  currentDate: Date,
  weekdays: string[],
  interval: number
): Date {
  const dayMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  const targetDays = weekdays
    .map((d) => dayMap[d.toLowerCase()])
    .filter((d) => d !== undefined);
  const currentDay = currentDate.getDay();

  for (const targetDay of targetDays.sort((a, b) => a - b)) {
    if (targetDay > currentDay) {
      return addDays(currentDate, targetDay - currentDay);
    }
  }

  const firstTargetDay = Math.min(...targetDays);
  const daysUntilNextWeek = 7 * interval - currentDay + firstTargetDay;
  return addDays(currentDate, daysUntilNextWeek);
}

function shouldGenerateOccurrence(
  rule: RecurrenceRule,
  nextDate: Date,
  currentSequence: number
): boolean {
  if (rule.end_type === "never") {
    return true;
  }

  if (rule.end_type === "on_date" && rule.end_date) {
    const endDate = parseISO(rule.end_date);
    return !isAfter(nextDate, endDate);
  }

  if (rule.end_type === "after_occurrences" && rule.end_occurrences) {
    return currentSequence < rule.end_occurrences;
  }

  return false;
}

function getProjectDate(project: Project): Date | null {
  const schedule = project.schedule as {
    oneTime?: { date?: string };
    sameDayMultiArea?: { date?: string };
  };

  if (project.event_type === "oneTime" && schedule.oneTime?.date) {
    return parseISO(schedule.oneTime.date);
  }

  if (project.event_type === "sameDayMultiArea" && schedule.sameDayMultiArea?.date) {
    return parseISO(schedule.sameDayMultiArea.date);
  }

  return null;
}

function updateScheduleDate(schedule: Record<string, unknown>, eventType: string, newDate: Date) {
  const formattedDate = format(newDate, "yyyy-MM-dd");
  const newSchedule = JSON.parse(JSON.stringify(schedule)) as {
    oneTime?: { date?: string };
    sameDayMultiArea?: { date?: string };
  };

  if (eventType === "oneTime" && newSchedule.oneTime) {
    newSchedule.oneTime.date = formattedDate;
  } else if (eventType === "sameDayMultiArea" && newSchedule.sameDayMultiArea) {
    newSchedule.sameDayMultiArea.date = formattedDate;
  }

  return newSchedule;
}

function initializePublishedState(eventType: string, schedule: Record<string, unknown>): Record<string, boolean> {
  const publishedState: Record<string, boolean> = {};

  if (eventType === "oneTime") {
    publishedState.oneTime = false;
  } else if (eventType === "sameDayMultiArea") {
    const typedSchedule = schedule as { sameDayMultiArea?: { roles?: Array<{ name: string }> } };
    typedSchedule.sameDayMultiArea?.roles?.forEach((role) => {
      publishedState[role.name] = false;
    });
  }

  return publishedState;
}

async function processRecurringProjects(): Promise<{
  processedProjects: number;
  createdOccurrences: number;
  errors: string[];
}> {
  const supabase = createServiceClient();
  const errors: string[] = [];
  let createdOccurrences = 0;

  const { data: parentProjects, error: fetchError } = await supabase
    .from("projects")
    .select("*")
    .not("recurrence_rule", "is", null)
    .is("recurrence_parent_id", null)
    .eq("workflow_status", "published")
    .not("status", "eq", "cancelled");

  if (fetchError) {
    return { processedProjects: 0, createdOccurrences: 0, errors: [fetchError.message] };
  }

  if (!parentProjects || parentProjects.length === 0) {
    return { processedProjects: 0, createdOccurrences: 0, errors: [] };
  }

  const lookAheadDate = addWeeks(new Date(), 4);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const parent of parentProjects as Project[]) {
    try {
      const rule = parent.recurrence_rule;
      if (!rule) continue;

      const { data: latestOccurrence } = await supabase
        .from("projects")
        .select("id, schedule, recurrence_sequence")
        .eq("recurrence_parent_id", parent.id)
        .order("recurrence_sequence", { ascending: false })
        .limit(1)
        .single();

      let currentSequence = 1;
      let lastDate: Date | null;

      if (!latestOccurrence) {
        lastDate = getProjectDate(parent);
        currentSequence = 1;
      } else {
        lastDate = getProjectDate({
          ...parent,
          schedule: latestOccurrence.schedule,
        } as Project);
        currentSequence = (latestOccurrence.recurrence_sequence || 1) + 1;
      }

      if (!lastDate) {
        continue;
      }

      let nextDate = calculateNextDate(lastDate, rule);

      while (
        nextDate &&
        isBefore(nextDate, lookAheadDate) &&
        shouldGenerateOccurrence(rule, nextDate, currentSequence)
      ) {
        if (isBefore(today, nextDate)) {
          const formattedNextDate = format(nextDate, "yyyy-MM-dd");

          let existingQuery = supabase
            .from("projects")
            .select("id")
            .eq("recurrence_parent_id", parent.id);

          if (parent.event_type === "oneTime") {
            existingQuery = existingQuery.filter(
              "schedule->oneTime->>date",
              "eq",
              formattedNextDate
            );
          } else if (parent.event_type === "sameDayMultiArea") {
            existingQuery = existingQuery.filter(
              "schedule->sameDayMultiArea->>date",
              "eq",
              formattedNextDate
            );
          }

          const { data: existing } = await existingQuery.limit(1).single();

          if (!existing) {
            const newSchedule = updateScheduleDate(parent.schedule, parent.event_type, nextDate);
            const publishedState = initializePublishedState(parent.event_type, newSchedule);

            const { error: insertError } = await supabase.from("projects").insert({
              creator_id: parent.creator_id,
              title: parent.title,
              description: parent.description,
              location: parent.location,
              location_data: parent.location_data,
              event_type: parent.event_type,
              schedule: newSchedule,
              verification_method: parent.verification_method,
              require_login: parent.require_login,
              enable_volunteer_comments: parent.enable_volunteer_comments,
              show_attendees_publicly: parent.show_attendees_publicly,
              organization_id: parent.organization_id,
              visibility: parent.visibility,
              project_timezone: parent.project_timezone,
              restrict_to_org_domains: parent.restrict_to_org_domains,
              status: "upcoming",
              workflow_status: "published",
              published: publishedState,
              recurrence_parent_id: parent.id,
              recurrence_sequence: currentSequence,
            });

            if (insertError) {
              errors.push(`Failed to create occurrence for ${parent.title}: ${insertError.message}`);
            } else {
              createdOccurrences++;
            }
          }
        }

        currentSequence++;
        nextDate = calculateNextDate(nextDate, rule);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      errors.push(`Error processing ${parent.title}: ${errorMessage}`);
    }
  }

  return {
    processedProjects: parentProjects.length,
    createdOccurrences,
    errors,
  };
}

export async function POST(request: NextRequest) {
  try {
    const auth = authorizeCronRequest(request);
    if (!auth.ok) return auth.response;

    const startTime = Date.now();
    const result = await processRecurringProjects();
    const executionTime = Date.now() - startTime;

    return NextResponse.json(
      {
        message: "Recurring projects processed",
        processedProjects: result.processedProjects,
        createdOccurrences: result.createdOccurrences,
        executionTimeMs: executionTime,
        errors: result.errors,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Internal server error", message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("status") === "1") {
    const auth = authorizeCronRequest(request);
    if (!auth.ok) return auth.response;

    return NextResponse.json({
      message: "Recurring projects cron service is running",
      timestamp: new Date().toISOString(),
    });
  }

  return POST(request);
}