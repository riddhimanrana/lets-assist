import { describe, expect, test } from "bun:test";
import { readProjectOccupancy } from "./occupancy-read";

const projectId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const row = {
  project_id: projectId,
  slots_filled: 1601,
  slots_filled_by_schedule: { oneTime: 1601 },
};

describe("bounded project occupancy reads", () => {
  test("retains exact aggregate counts above the REST row cap and explicit zeros", async () => {
    const result = await readProjectOccupancy(
      [projectId, otherId],
      async () => ({
        data: [
          row,
          {
            project_id: otherId,
            slots_filled: 0,
            slots_filled_by_schedule: {},
          },
        ],
        error: null,
      }),
    );
    expect(result[projectId]).toEqual({
      slotsFilled: 1601,
      slotsFilledBySchedule: { oneTime: 1601 },
    });
    expect(result[otherId].slotsFilled).toBe(0);
  });
  test("empty pages do not call the database", async () => {
    expect(
      await readProjectOccupancy([], async () => {
        throw new Error("must not query");
      }),
    ).toEqual({});
  });
  test("errors and incomplete or invalid results never become zero capacity", async () => {
    for (const data of [
      null,
      [],
      [row, row],
      [{ ...row, project_id: otherId }],
      [{ ...row, slots_filled: -1 }],
      [{ ...row, slots_filled: "1601" }],
      [{ ...row, slots_filled: 1 }],
      [{ ...row, slots_filled_by_schedule: { oneTime: -1 } }],
    ]) {
      await expect(
        readProjectOccupancy([projectId], async () => ({ data, error: null })),
      ).rejects.toThrow("unavailable");
    }
    await expect(
      readProjectOccupancy([projectId], async () => ({
        data: [row],
        error: { code: "unavailable" },
      })),
    ).rejects.toThrow("unavailable");
  });
  test("rejects oversized batches before a database request", async () => {
    await expect(
      readProjectOccupancy(Array(101).fill(projectId), async () => {
        throw new Error("must not query");
      }),
    ).rejects.toThrow("batch is too large");
  });
});
