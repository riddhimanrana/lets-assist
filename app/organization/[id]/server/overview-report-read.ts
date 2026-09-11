import "server-only";

type Summary = { totalHours: number };
export async function loadVisibleOrganizationReport(input: {
  hidden: boolean;
  userRole: string | null;
  getStaffReport: () => Promise<{ data?: { metrics?: Summary } | null }>;
  getPublicSummary: () => Promise<Summary | null>;
}): Promise<Summary | null> {
  if (input.hidden) return null;
  if (input.userRole === "admin" || input.userRole === "staff") {
    const report = await input.getStaffReport();
    if (report.data?.metrics)
      return { totalHours: report.data.metrics.totalHours };
  }
  return input.getPublicSummary();
}
