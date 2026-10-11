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
