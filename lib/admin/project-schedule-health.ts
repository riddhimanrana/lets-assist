import { z } from "zod";

const healthSchema = z.object({
  invalid_count: z.number().int().nonnegative().safe(),
  projects: z
    .array(
      z.object({
        id: z.uuid(),
        title: z.string(),
        event_type: z.string(),
        organization_id: z.uuid().nullable(),
      }),
    )
    .max(100),
  last_run: z
    .object({
      invalid_count: z.number().int().nonnegative().safe(),
      fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
      checked_at: z.iso.datetime({ offset: true }),
      changed_at: z.iso.datetime({ offset: true }),
    })
    .nullable(),
});

export type ProjectScheduleHealth = z.infer<typeof healthSchema>;
export type ProjectScheduleHealthResult =
  | { data: ProjectScheduleHealth; error?: never }
  | { data?: never; error: string };

export function parseProjectScheduleHealth(
  value: unknown,
): ProjectScheduleHealthResult {
  const parsed = healthSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.projects.length > parsed.data.invalid_count ||
    new Set(parsed.data.projects.map((project) => project.id)).size !==
      parsed.data.projects.length
  ) {
    return {
      error:
        "Schedule health is unavailable. No clear status can be confirmed.",
    };
  }
  return { data: parsed.data };
}

export function scheduleMaintenanceState(
  health: ProjectScheduleHealth,
  now = Date.now(),
) {
  if (!health.last_run) return "no_run" as const;
  if (now - Date.parse(health.last_run.checked_at) > 15 * 60 * 1000)
    return "stale" as const;
  return health.invalid_count > 0
    ? ("needs_correction" as const)
    : ("current" as const);
}
