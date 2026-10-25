import { z } from "zod";
import type { ProjectOccupancySummary } from "./availability";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const occupancyRows = z.array(
  z.object({
    project_id: z.string().uuid(),
    slots_filled: count,
    slots_filled_by_schedule: z.record(z.string(), count),
  }),
);

export async function readProjectOccupancy(
  projectIds: string[],
  query: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<Record<string, ProjectOccupancySummary>> {
  if (projectIds.length === 0) return {};
  if (projectIds.length > 100)
    throw new Error("Project occupancy batch is too large");
  const { data, error } = await query();
  const result = occupancyRows.safeParse(data);
  if (error || !result.success)
    throw new Error("Project availability is unavailable");

  const expected = new Set(projectIds);
  const summaries: Record<string, ProjectOccupancySummary> = {};
  for (const row of result.data) {
    if (
      !expected.has(row.project_id) ||
      summaries[row.project_id] ||
      Object.values(row.slots_filled_by_schedule).reduce(
        (sum, value) => sum + value,
        0,
      ) > row.slots_filled
    )
      throw new Error("Project availability is unavailable");
    summaries[row.project_id] = {
      slotsFilled: row.slots_filled,
      slotsFilledBySchedule: row.slots_filled_by_schedule,
    };
  }
  if (Object.keys(summaries).length !== expected.size) {
    throw new Error("Project availability is unavailable");
  }
  return summaries;
}
