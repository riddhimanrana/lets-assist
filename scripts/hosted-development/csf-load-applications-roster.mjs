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
