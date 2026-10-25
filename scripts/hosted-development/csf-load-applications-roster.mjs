export function applicationsRosterSearch(page) {
  return page
    .locator('[data-slot="tabs-content"]:visible #applications')
    .getByPlaceholder("Search by name", { exact: true });
}

// The nearest ancestor of the search field that also holds the list, so a
// change to the wrapper's layout classes cannot break the lookup.
export function applicationsRosterSubjects(search) {
  return search
    .locator("xpath=ancestor::div[.//ul][1]")
    .locator("ul > li button");
}

// The queue panel carries `data-review-record` only while a loaded record is
// on screen. An application is read after the queue moves to it, so a panel
// that is still loading, or that failed to load, has no marker and is never
// accepted as the selected subject.
export function loadedReviewRecord(queue) {
  return queue.locator(":scope > [data-review-record]");
}

// Wait for a loaded record, and for one other than `previousRecord` when the
// queue has just been moved. The allowance is the one this run already gives
// a queue control to respond; reaching it is a failure, not a skip.
/**
 * @param {import("@playwright/test").Locator} queue
 * @param {string | null} [previousRecord] The record on screen before the
 *   queue was moved, or null when any loaded record is the answer.
 * @param {number} [timeoutMs]
 * @returns {Promise<string>} The loaded record's subject id.
 */
export async function waitForLoadedReviewRecord(
  queue,
  previousRecord = null,
  timeoutMs = 60_000,
) {
  const deadline = performance.now() + timeoutMs;
  const record = loadedReviewRecord(queue);
  while (true) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      throw new Error(
        "The fictional application review queue did not show a loaded record within the allowed time.",
      );
    }
    try {
      await record.waitFor({
        state: "attached",
        timeout: Math.min(1000, remaining),
      });
      const current = await record.getAttribute("data-review-record", {
        timeout: Math.min(1000, remaining),
      });
      if (current && current !== previousRecord) return current;
    } catch (error) {
      if (error?.name !== "TimeoutError") throw error;
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// The SSR roster can be visible before its client click handler is attached.
// Retry only this read-only entry while the roster remains visible; once the
// queue opens, never click another subject during its pending transition.
// Keep the original overall deadline and surface genuine loading failures.
export async function openApplicationsReviewQueue(search, queue) {
  const deadline = performance.now() + 60_000;
  const timeout = () => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      throw new Error(
        "The fictional application review queue did not become ready within 60 seconds.",
      );
    }
    return Math.min(1000, remaining);
  };
  while (true) {
    try {
      if (await search.isVisible()) {
        await applicationsRosterSubjects(search)
          .first()
          .click({ timeout: timeout() });
      }
      await queue.waitFor({ state: "visible", timeout: timeout() });
      return;
    } catch (error) {
      if (error?.name !== "TimeoutError") throw error;
    }
  }
}
