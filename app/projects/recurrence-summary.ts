import { format } from "date-fns";

import type { RecurrenceRule, RecurrenceWeekday } from "@/types";

const WEEKDAY_LABELS: Record<RecurrenceWeekday, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

/** One line describing how a project repeats, for the projects list. */
export function formatRecurrenceSummary(rule: RecurrenceRule): string {
  if (!rule.frequency) return "";

  const interval = rule.interval || 1;
  let frequencyLabel: string;
  switch (rule.frequency) {
    case "daily":
      frequencyLabel = interval === 1 ? "day" : `${interval} days`;
      break;
    case "weekly":
      frequencyLabel = interval === 1 ? "week" : `${interval} weeks`;
      break;
    case "monthly":
      frequencyLabel = interval === 1 ? "month" : `${interval} months`;
      break;
    case "yearly":
      frequencyLabel = interval === 1 ? "year" : `${interval} years`;
      break;
    default:
      frequencyLabel = "week";
  }

  let summary = `Repeats every ${frequencyLabel}`;

  if (
    rule.frequency === "weekly" &&
    rule.weekdays &&
    rule.weekdays.length > 0
  ) {
    const dayNames = rule.weekdays
      .map((d) => WEEKDAY_LABELS[d])
      .filter(Boolean)
      .join(", ");
    summary += ` on ${dayNames}`;
  }

  if (rule.end_type === "on_date" && rule.end_date) {
    const [year, month, day] = rule.end_date.split("-").map(Number);
    summary += ` until ${format(new Date(year, month - 1, day), "MMM d, yyyy")}`;
  } else if (rule.end_type === "after_occurrences" && rule.end_occurrences) {
    summary += `, ${rule.end_occurrences} times`;
  } else if (rule.end_type === "never") {
    summary += " (ongoing)";
  }

  return summary;
}
