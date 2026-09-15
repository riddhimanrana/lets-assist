export function applicationsRosterSearch(page) {
  return page
    .locator('[data-slot="tabs-content"]:visible #applications')
    .getByPlaceholder("Search by name", { exact: true });
}
