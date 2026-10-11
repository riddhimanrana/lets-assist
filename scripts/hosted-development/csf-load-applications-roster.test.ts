import { expect, spyOn, test } from "bun:test";
import { openApplicationsReviewQueue } from "./csf-load-applications-roster.mjs";

function fixture({
  ignoredClicks = 0,
  pending = 0,
  failure,
}: { ignoredClicks?: number; pending?: number; failure?: Error } = {}) {
  let clicks = 0;
  let waits = 0;
  let rosterVisible = true;
  const button = {
    click: async () => {
      clicks++;
      if (clicks > ignoredClicks) rosterVisible = false;
    },
  };
  const subjects = { first: () => button };
  const list = { locator: () => subjects };
  const search = { isVisible: async () => rosterVisible, locator: () => list };
  const queue = {
    waitFor: async ({ timeout }: { timeout: number }) => {
      waits++;
      expect(timeout).toBeGreaterThan(0);
      expect(timeout).toBeLessThanOrEqual(1000);
      if (failure) throw failure;
      if (rosterVisible || waits <= ignoredClicks + pending) {
        const error = new Error("synthetic pending queue");
        error.name = "TimeoutError";
        throw error;
      }
    },
  };
  return { search, queue, counts: () => ({ clicks, waits }) };
}

test("retries a read-only roster click ignored before hydration", async () => {
  const flow = fixture({ ignoredClicks: 1 });
  await openApplicationsReviewQueue(flow.search, flow.queue);
  expect(flow.counts()).toEqual({ clicks: 2, waits: 2 });
});

test("does not re-enter the roster while its opened queue is pending", async () => {
  const flow = fixture({ pending: 2 });
  await openApplicationsReviewQueue(flow.search, flow.queue);
  expect(flow.counts()).toEqual({ clicks: 1, waits: 3 });
});

test("surfaces genuine browser errors instead of treating them as readiness", async () => {
  const failure = new Error("synthetic browser disconnected");
  const flow = fixture({ failure });
  await expect(
    openApplicationsReviewQueue(flow.search, flow.queue),
  ).rejects.toBe(failure);
  expect(flow.counts()).toEqual({ clicks: 1, waits: 1 });
});

test("readiness retries cannot exceed the original sixty-second deadline", async () => {
  const clock = spyOn(performance, "now")
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValue(60_001);
  try {
    const flow = fixture({ ignoredClicks: 100 });
    await expect(
      openApplicationsReviewQueue(flow.search, flow.queue),
    ).rejects.toThrow("within 60 seconds");
    expect(flow.counts()).toEqual({ clicks: 1, waits: 1 });
  } finally {
    clock.mockRestore();
  }
});
