"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Clock, FileSpreadsheet, Timer, Upload, CheckCircle2 } from "lucide-react";
import Link from "next/link";

export function ProjectsSection() {
  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-2 gap-6">
        <Card id="projects-creating">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Creating Projects
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Accordion type="single" collapsible>
              <AccordionItem value="new-project">
                <AccordionTrigger>How to Create a New Project</AccordionTrigger>
                <AccordionContent className="space-y-2 text-sm">
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Click the &quot;Create Project&quot; button from dashboard or projects page</li>
                    <li>Fill in project name and detailed description</li>
                    <li>Set start and end dates for your volunteer work</li>
                    <li>Choose project category (Community Service, Education, Environment, etc.)</li>
                    <li>Set hour tracking preferences and verification requirements</li>
                    <li>Add location if applicable</li>
                    <li>Invite team members (optional)</li>
                  </ol>
                  <div className="mt-3">
                    <Button asChild size="sm">
                      <Link href="/projects/create">Create Your First Project</Link>
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
              
              {/* <AccordionItem value="project-types">
                <AccordionTrigger>Project Types</AccordionTrigger>
                <AccordionContent className="space-y-2 text-sm">
                  <ul className="space-y-2">
                    <li><strong>Individual:</strong> Personal volunteer work you track independently</li>
                    <li><strong>Team:</strong> Collaborative projects with multiple volunteers</li>
                    <li><strong>Organization:</strong> Projects managed by verified partner organizations</li>
                    <li><strong>Event:</strong> One-time volunteer events with specific dates</li>
                    <li><strong>Ongoing:</strong> Long-term commitments like tutoring or mentoring</li>
                  </ul>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="project-categories">
                <AccordionTrigger>Project Categories</AccordionTrigger>
                <AccordionContent className="space-y-2 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <Badge variant="outline">Community Service</Badge>
                    <Badge variant="outline">Education</Badge>
                    <Badge variant="outline">Environment</Badge>
                    <Badge variant="outline">Healthcare</Badge>
                    <Badge variant="outline">Animal Welfare</Badge>
                    <Badge variant="outline">Senior Care</Badge>
                    <Badge variant="outline">Youth Development</Badge>
                    <Badge variant="outline">Arts & Culture</Badge>
                    <Badge variant="outline">Disaster Relief</Badge>
                    <Badge variant="outline">Other</Badge>
                  </div>
                </AccordionContent>
              </AccordionItem> */}
            </Accordion>
          </CardContent>
        </Card>

        <Card id="projects-tracking">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Hour Tracking
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Accordion type="single" collapsible>
              <AccordionItem value="track-hours">
                <AccordionTrigger>Ways to Track Your Hours</AccordionTrigger>
                <AccordionContent className="space-y-3 text-sm">
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <Timer className="h-4 w-4 mt-1 text-primary" />
                      <div>
                        <h6 className="font-medium">Live Timer</h6>
                        <p className="text-muted-foreground">Start/stop timer while volunteering for accurate tracking</p>
                      </div>
                    </div>
                    {/* <div className="flex items-start gap-3">
                      <Clock className="h-4 w-4 mt-1 text-primary" />
                      <div>
                        <h6 className="font-medium">Manual Entry</h6>
                        <p className="text-muted-foreground">Add hours after completing work with date and description</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Upload className="h-4 w-4 mt-1 text-primary" />
                      <div>
                        <h6 className="font-medium">Bulk Import</h6>
                        <p className="text-muted-foreground">Upload hours from spreadsheet for multiple entries</p>
                      </div>
                    </div> */}
                  </div>
                </AccordionContent>
              </AccordionItem>
              
              <AccordionItem value="verification">
                <AccordionTrigger>Hour Verification Process</AccordionTrigger>
                <AccordionContent className="space-y-2 text-sm">
                  <p>Your volunteer hours can be verified through:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    {/* <li><strong>Project supervisors:</strong> People you designate as supervisors</li> */}
                    <li><strong>Organization coordinators:</strong> Official organization administrators</li>
                    <li><strong>Automatic verification:</strong> For certain project types and organizations</li>
                    <li><strong>Self-verification:</strong> For individual projects (noted in certificates)</li>
                  </ul>
                  <div className="mt-2 p-2 bg-muted/50 rounded text-xs">
                    <strong>Tip:</strong> Verified hours from organizations carry more weight for school requirements
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="certificates">
                <AccordionTrigger>Earning Certificates</AccordionTrigger>
                <AccordionContent className="space-y-2 text-sm">
                  <p>After completing volunteer work, you automatically receive:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Digital certificate with project details</li>
                    <li>Hour totals and verification status</li>
                    <li>Downloadable PDF for records</li>
                    <li>Shareable links for verification</li>
                  </ul>
                  <Button asChild size="sm" variant="outline" className="mt-2">
                    <Link href="/certificates">View My Certificates</Link>
                  </Button>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      </div>

      <Card id="projects-csv">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Data Export & Import
          </CardTitle>
          <CardDescription>
            Export your data or import existing volunteer records
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible>
            <AccordionItem value="csv-export">
              <AccordionTrigger>Exporting Your Data</AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm">
                <p>Export your volunteer hours for reports or school requirements:</p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <h6 className="font-medium mb-2">From Dashboard:</h6>
                    <ol className="list-decimal list-inside space-y-1 text-xs">
                      <li>Go to your Dashboard</li>
                      <li>Click &quot;Export Certificates&quot; button</li>
                      <li>Select date range (optional)</li>
                      <li>Download CSV file</li>
                    </ol>
                  </div>
                  <div>
                    <h6 className="font-medium mb-2">From Certificates Page:</h6>
                    <ol className="list-decimal list-inside space-y-1 text-xs">
                      <li>Visit your Certificates page</li>
                      <li>Use export options</li>
                      <li>Print or save individual certificates</li>
                      <li>Bulk export all certificates</li>
                    </ol>
                  </div>
                </div>
                <div className="bg-chart-3/20 p-3 rounded-lg">
                  <p className="text-xs"><strong>Tip:</strong> CSV files can be opened in Excel or Google Sheets for further analysis and school submissions.</p>
                </div>
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="csv-import">
              <AccordionTrigger>Importing Existing Records</AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm">
                <p>Upload your existing volunteer hour records:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Prepare your CSV with columns: Date, Hours, Description, Organization</li>
                  <li>Go to Projects → Import Hours</li>
                  <li>Upload your CSV file</li>
                  <li>Review and map columns</li>
                  <li>Confirm import</li>
                </ol>
                <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                  <h6 className="font-medium text-xs mb-1">Required CSV Format:</h6>
                  <code className="text-xs bg-background p-1 rounded">Date,Hours,Description,Organization</code>
                  <br />
                  <code className="text-xs bg-background p-1 rounded">2024-01-15,2.5,&quot;Food bank sorting&quot;,Local Food Bank</code>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="project-management">
              <AccordionTrigger>Managing Your Projects</AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm">
                <p>Keep your projects organized and up-to-date:</p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <h6 className="font-medium mb-2">Project Status:</h6>
                    <ul className="space-y-1 text-xs">
                      <li><Badge variant="outline" className="mr-1">Planning</Badge> Project being set up</li>
                      <li><Badge variant="outline" className="mr-1">Active</Badge> Currently accepting volunteers</li>
                      <li><Badge variant="outline" className="mr-1">Completed</Badge> Project finished</li>
                      <li><Badge variant="outline" className="mr-1">Cancelled</Badge> Project cancelled</li>
                    </ul>
                  </div>
                  <div>
                    <h6 className="font-medium mb-2">Project Actions:</h6>
                    <ul className="space-y-1 text-xs">
                      <li>Edit project details anytime</li>
                      <li>Add or remove team members</li>
                      <li>Update project status</li>
                      <li>View participant statistics</li>
                      <li>Export project data</li>
                    </ul>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
