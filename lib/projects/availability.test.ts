import { describe, expect, it } from "bun:test";

import {
  ACTIVE_PROJECT_SIGNUP_STATUSES,
  formatSpotsLeft,
  getProjectRemainingSpots,
} from "@/lib/projects/availability";
import type { Project } from "@/types";
import { getSlotCapacities } from "@/utils/project";

const PROJECT_ID = "fictional-project";

const project = {
  id: PROJECT_ID,
  event_type: "oneTime",
  schedule: {
    oneTime: {
      date: "2030-03-14",
      startTime: "09:00",
      endTime: "12:00",
      volunteers: 25,
    },
  },
} as unknown as Project;

const signups = [
  "pending",
  "approved",
  "attended",
  "rejected",
  "cancelled",
].map((status) => ({ project_id: PROJECT_ID, schedule_id: "oneTime", status }));

type Filter = { column: string; values: readonly string[] };

/**
 * Stands in for PostgREST: applies the `.eq` and `.in` filters the caller
 * asks for, so a status list that drops `pending` shows up in the result.
 */
function createSignupClient(rows: typeof signups) {
  const requested: Filter[] = [];
  const query = {
    select: () => query,
    eq: (column: string, value: string) => {
      requested.push({ column, values: [value] });
      return query;
    },
    in: (column: string, values: readonly string[]) => {
      requested.push({ column, values });
      return query;
    },
    then: (resolve: (result: { data: typeof signups; error: null }) => void) =>
      resolve({
        data: rows.filter((row) =>
          requested.every(({ column, values }) =>
            values.includes(String(row[column as keyof typeof row])),
          ),
        ),
        error: null,
      }),
  };
  const client = { from: () => query } as unknown as Parameters<
    typeof getSlotCapacities
  >[1];
  return { client, requested };
}

describe("remaining capacity", () => {
  it("counts pending, approved and attended sign-ups as taken, and nothing else", () => {
    expect([...ACTIVE_PROJECT_SIGNUP_STATUSES]).toEqual([
      "pending",
      "approved",
      "attended",
    ]);
  });

  it("gives the project card and the project page the same number", async () => {
    const { client, requested } = createSignupClient(signups);

    const cardRemaining = getProjectRemainingSpots({ ...project, signups });
    const pageRemaining = await getSlotCapacities(project, client, PROJECT_ID);

    expect(cardRemaining).toBe(22);
    expect(pageRemaining).toEqual({ oneTime: 22 });
    expect(pageRemaining.oneTime).toBe(cardRemaining);
    expect(requested.find(({ column }) => column === "status")?.values).toEqual(
      [...ACTIVE_PROJECT_SIGNUP_STATUSES],
    );
  });

  it("still agrees when the database returns rows the filter should have dropped", async () => {
    const unfiltered = {
      from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          in: () => query,
          then: (resolve: (result: unknown) => void) =>
            resolve({ data: signups, error: null }),
        };
        return query;
      },
    } as unknown as Parameters<typeof getSlotCapacities>[1];

    expect(await getSlotCapacities(project, unfiltered, PROJECT_ID)).toEqual({
      oneTime: 22,
    });
  });
});

describe("formatSpotsLeft", () => {
  it("uses one wording for every surface", () => {
    expect(formatSpotsLeft(23, 25)).toBe("23 of 25 spots left");
    expect(formatSpotsLeft(1, 25)).toBe("1 of 25 spots left");
    expect(formatSpotsLeft(1, 1)).toBe("1 of 1 spot left");
    expect(formatSpotsLeft(22)).toBe("22 spots left");
    expect(formatSpotsLeft(1)).toBe("1 spot left");
    expect(formatSpotsLeft(0, 25)).toBe("Full");
    expect(formatSpotsLeft(0)).toBe("Full");
  });
});
