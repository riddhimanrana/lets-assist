import { expect, mock, test } from "bun:test";
import { loadVisibleOrganizationReport } from "./overview-report-read";
test("hidden platform overview loads neither private reports nor public totals", async () => {
  for (const userRole of ["admin", "staff", "member", null]) {
    const getStaffReport = mock(async () => ({
      data: { metrics: { totalHours: 8 } },
    }));
    const getPublicSummary = mock(async () => ({ totalHours: 4 }));
    expect(
      await loadVisibleOrganizationReport({
        hidden: true,
        userRole,
        getStaffReport,
        getPublicSummary,
      }),
    ).toBeNull();
    expect(getStaffReport).not.toHaveBeenCalled();
    expect(getPublicSummary).not.toHaveBeenCalled();
  }
});
test("visible platform overview preserves staff totals and public fallback", async () => {
  const getPublicSummary = mock(async () => ({ totalHours: 4 }));
  expect(
    await loadVisibleOrganizationReport({
      hidden: false,
      userRole: "staff",
      getStaffReport: async () => ({ data: { metrics: { totalHours: 8 } } }),
      getPublicSummary,
    }),
  ).toEqual({ totalHours: 8 });
  expect(getPublicSummary).not.toHaveBeenCalled();
  expect(
    await loadVisibleOrganizationReport({
      hidden: false,
      userRole: "admin",
      getStaffReport: async () => ({ data: null }),
      getPublicSummary,
    }),
  ).toEqual({ totalHours: 4 });
  const forbiddenStaffRead = mock(async () => {
    throw new Error("Member cannot read staff reports");
  });
  expect(
    await loadVisibleOrganizationReport({
      hidden: false,
      userRole: "member",
      getStaffReport: forbiddenStaffRead,
      getPublicSummary,
    }),
  ).toEqual({ totalHours: 4 });
  expect(forbiddenStaffRead).not.toHaveBeenCalled();
});
