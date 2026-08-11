"use server";

import {
  exportOrganizationReport as exportOrganizationReportInternal,
  getOrganizationReportData as getOrganizationReportDataInternal,
} from "@/lib/organization/report-service";
import type {
  OrganizationReportData,
  ReportDateRange,
  ReportType,
} from "@/lib/organization/report-service";

export type {
  OrganizationReportData,
  ReportDateRange,
  ReportType,
} from "@/lib/organization/report-service";

export async function getOrganizationReportData(
  organizationId: string,
  dateRange?: ReportDateRange,
): Promise<{ data?: OrganizationReportData; error?: string }> {
  return getOrganizationReportDataInternal(organizationId, dateRange);
}

export async function exportOrganizationReport(
  organizationId: string,
  reportType: ReportType,
  dateRange?: ReportDateRange,
): Promise<{ csvData?: string; error?: string; filename?: string }> {
  return exportOrganizationReportInternal(
    organizationId,
    reportType,
    dateRange,
  );
}
