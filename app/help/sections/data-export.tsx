"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileSpreadsheet, Download, Calendar, Filter, BarChart3, TrendingUp } from "lucide-react";
import Link from "next/link";

export function DataExportSection() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Data Export & Analytics
          </CardTitle>
          <CardDescription>
            Export your data for reports, analysis, and school requirements
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Personal Data</h4>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>• Your volunteer certificates</li>
                <li>• Hour tracking data</li>
                <li>• Project participation</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Organization Data</h4>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>• Member volunteer hours</li>
                <li>• Project participation rates</li>
                <li>• Organization analytics</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Export Formats</h4>
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline" className="text-xs">CSV</Badge>
                <Badge variant="outline" className="text-xs">PDF</Badge>
                <Badge variant="outline" className="text-xs">Print</Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Accordion type="single" collapsible className="w-full space-y-4">
        <AccordionItem value="personal-exports" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Personal Data Exports
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h6 className="font-medium mb-2 flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4" />
                  Certificate Export (Dashboard)
                </h6>
                <ol className="list-decimal list-inside space-y-1 text-sm">
                  <li>Go to your Dashboard</li>
                  <li>Find &quot;Export Certificates&quot; section</li>
                  <li>Select date range (optional)</li>
                  <li>Click &quot;Export CSV&quot;</li>
                  <li>Download comprehensive data file</li>
                </ol>
                <div className="mt-2 text-xs text-muted-foreground">
                  <strong>Includes:</strong> All certificate details, hours, organizations, verification status, and summary statistics
                </div>
              </div>
              <div>
                <h6 className="font-medium mb-2 flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Date Range Filtering
                </h6>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Lifetime data (all certificates)</li>
                  <li>Specific date ranges</li>
                  <li>Academic year filtering</li>
                  <li>Semester or quarter exports</li>
                  <li>Custom date selections</li>
                </ul>
                <div className="mt-2 text-xs text-muted-foreground">
                  Perfect for school deadlines and reporting requirements
                </div>
              </div>
            </div>

            <div className="bg-chart-3/20 p-4 rounded-lg">
              <h6 className="font-medium text-sm mb-2">CSV Export Contents:</h6>
              <div className="grid md:grid-cols-2 gap-3 text-xs">
                <div>
                  <strong>Basic Information:</strong>
                  <ul className="mt-1 space-y-1">
                    <li>• Certificate ID and project title</li>
                    <li>• Organization and creator names</li>
                    <li>• Event dates and duration</li>
                    <li>• Location and verification status</li>
                  </ul>
                </div>
                <div>
                  <strong>Summary Data:</strong>
                  <ul className="mt-1 space-y-1">
                    <li>• Total certificates and hours</li>
                    <li>• Certified vs. participated breakdown</li>
                    <li>• Unique organizations and projects</li>
                    <li>• Date range and generation info</li>
                  </ul>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="organization-exports" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Organization Data Exports (Admin/Staff)
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h6 className="font-medium mb-2">Member Hours Export</h6>
                <ol className="list-decimal list-inside space-y-1 text-sm">
                  <li>Navigate to your organization page</li>
                  <li>Click &quot;Members&quot; tab</li>
                  <li>Set date range filter (optional)</li>
                  <li>Click &quot;Export Members&quot; button</li>
                  <li>Download CSV with all member data</li>
                </ol>
                <div className="mt-2 p-2 bg-muted/50 rounded text-xs">
                  <strong>Permissions:</strong> Only available to organization admins and staff members
                </div>
              </div>
              <div>
                <h6 className="font-medium mb-2">Individual Member Details</h6>
                <ol className="list-decimal list-inside space-y-1 text-sm">
                  <li>Go to Members tab</li>
                  <li>Click &quot;View Details&quot; on any member</li>
                  <li>Review their volunteer history</li>
                  <li>Export individual member report</li>
                  <li>Access detailed event logs</li>
                </ol>
                <div className="mt-2 p-2 bg-muted/50 rounded text-xs">
                  <strong>Use Case:</strong> Perfect for verification requests and individual member reports
                </div>
              </div>
            </div>

            <div className="bg-primary/10 p-4 rounded-lg">
              <h6 className="font-medium text-sm mb-2">Organization Export Features:</h6>
              <div className="grid md:grid-cols-2 gap-3 text-xs">
                <div>
                  <strong>Member Data Includes:</strong>
                  <ul className="mt-1 space-y-1">
                    <li>• Member names and usernames</li>
                    <li>• Roles and join dates</li>
                    <li>• Total volunteer hours</li>
                    <li>• Event participation counts</li>
                    <li>• Last activity dates</li>
                  </ul>
                </div>
                <div>
                  <strong>Date Range Options:</strong>
                  <ul className="mt-1 space-y-1">
                    <li>• Lifetime member data</li>
                    <li>• Specific time periods</li>
                    <li>• Academic year filtering</li>
                    <li>• Custom date ranges</li>
                    <li>• Real-time data updates</li>
                  </ul>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="analytics-insights" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Analytics & Insights
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h6 className="font-medium mb-2">Personal Dashboard Analytics</h6>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Total volunteer hours tracked</li>
                  <li>Number of projects completed</li>
                  <li>Organizations you&apos;ve worked with</li>
                  <li>Monthly hour tracking trends</li>
                  <li>Certificate achievement milestones</li>
                </ul>
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link href="/dashboard">View My Analytics</Link>
                </Button>
              </div>
              <div>
                <h6 className="font-medium mb-2">Organization Analytics (Admin)</h6>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Member engagement statistics</li>
                  <li>Project participation rates</li>
                  <li>Total organizational impact</li>
                  <li>Member growth and retention</li>
                  <li>Verification and completion rates</li>
                </ul>
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link href="/organization">View Organizations</Link>
                </Button>
              </div>
            </div>

            <div className="bg-muted/50 p-4 rounded-lg">
              <h6 className="font-medium text-sm mb-2">Using Data for Impact:</h6>
              <div className="grid md:grid-cols-3 gap-3 text-xs">
                <div>
                  <strong>For Students:</strong>
                  <ul className="mt-1 space-y-1">
                    <li>• School applications</li>
                    <li>• Scholarship submissions</li>
                    <li>• Resume building</li>
                    <li>• Academic requirements</li>
                  </ul>
                </div>
                <div>
                  <strong>For Organizations:</strong>
                  <ul className="mt-1 space-y-1">
                    <li>• Grant applications</li>
                    <li>• Impact reporting</li>
                    <li>• Member recognition</li>
                    <li>• Program evaluation</li>
                  </ul>
                </div>
                <div>
                  <strong>For Analysis:</strong>
                  <ul className="mt-1 space-y-1">
                    <li>• Trend identification</li>
                    <li>• Goal tracking</li>
                    <li>• Performance metrics</li>
                    <li>• Impact measurement</li>
                  </ul>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="export-tips" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Export Tips & Best Practices
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h6 className="font-medium mb-2">For School Submissions:</h6>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Export data regularly, don&apos;t wait for deadlines</li>
                  <li>Use specific date ranges for academic periods</li>
                  <li>Include verified organization hours when possible</li>
                  <li>Keep both CSV and PDF copies</li>
                  <li>Document supervisor contact information</li>
                </ul>
              </div>
              <div>
                <h6 className="font-medium mb-2">For Organizations:</h6>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Export member data monthly for tracking</li>
                  <li>Use date filters for specific reporting periods</li>
                  <li>Maintain backup copies of member records</li>
                  <li>Share individual reports with members</li>
                  <li>Generate summary reports for leadership</li>
                </ul>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <div className="p-3 border rounded">
                <h6 className="font-medium text-xs mb-1">File Formats</h6>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>• CSV: For data analysis</li>
                  <li>• PDF: For printing/submission</li>
                  <li>• Print: For physical copies</li>
                </ul>
              </div>
              <div className="p-3 border rounded">
                <h6 className="font-medium text-xs mb-1">Data Privacy</h6>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>• Only your data in personal exports</li>
                  <li>• Org exports respect member privacy</li>
                  <li>• Secure download links</li>
                </ul>
              </div>
              <div className="p-3 border rounded">
                <h6 className="font-medium text-xs mb-1">Technical Tips</h6>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>• CSV opens in Excel/Sheets</li>
                  <li>• Use filters for large datasets</li>
                  <li>• Save with descriptive filenames</li>
                </ul>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
