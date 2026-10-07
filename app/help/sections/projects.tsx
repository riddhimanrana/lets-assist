"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Timer } from "lucide-react";
import Link from "next/link";

export function ProjectsSection() {
  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-2 gap-6">
        <Card id="projects-creating">
          <CardHeader>
            <CardTitle>Creating projects</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Accordion>
              <AccordionItem value="new-project">
                <AccordionTrigger>How to create a new project</AccordionTrigger>
                <AccordionContent className="space-y-2 text-sm">
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>
                      Click the &quot;Create project&quot; button from dashboard
                      or projects page
                    </li>
                    <li>Fill in project name and detailed description</li>
                    <li>Set start and end dates for your volunteer work</li>
                    <li>
                      Choose project category (Community Service, Education,
                      Environment, etc.)
                    </li>
                    <li>
                      Set hour tracking preferences and verification
                      requirements
                    </li>
                    <li>Add location if applicable</li>
                    <li>Invite team members (optional)</li>
                  </ol>
                  <div className="mt-3">
                    <Link
                      href="/projects/create"
                      className={cn(buttonVariants({ variant: "outline" }))}
                    >
                      Create your first project
                    </Link>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* <AccordionItem value="project-types">
                <AccordionTrigger>Project types</AccordionTrigger>
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
                <AccordionTrigger>Project categories</AccordionTrigger>
                <AccordionContent className="space-y-2 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <Badge variant="outline">Community service</Badge>
                    <Badge variant="outline">Education</Badge>
                    <Badge variant="outline">Environment</Badge>
                    <Badge variant="outline">Healthcare</Badge>
                    <Badge variant="outline">Animal welfare</Badge>
                    <Badge variant="outline">Senior care</Badge>
                    <Badge variant="outline">Youth development</Badge>
                    <Badge variant="outline">Arts & culture</Badge>
                    <Badge variant="outline">Disaster relief</Badge>
                    <Badge variant="outline">Other</Badge>
                  </div>
                </AccordionContent>
              </AccordionItem> */}
            </Accordion>
          </CardContent>
        </Card>

        <Card id="projects-tracking">
          <CardHeader>
            <CardTitle>Hour tracking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Accordion>
              <AccordionItem value="track-hours">
                <AccordionTrigger>Ways to track your hours</AccordionTrigger>
                <AccordionContent className="space-y-3 text-sm">
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <Timer
                        aria-hidden="true"
                        className="text-muted-foreground mt-0.5 size-4 shrink-0"
                      />
                      <div>
                        <h6 className="font-medium">Live timer</h6>
                        <p className="text-muted-foreground">
                          Start/stop timer while volunteering for accurate
                          tracking
                        </p>
                      </div>
                    </div>
                    {/* <div className="flex items-start gap-3">
                      <Clock aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                      <div>
                        <h6 className="font-medium">Manual entry</h6>
                        <p className="text-muted-foreground">Add hours after completing work with date and description</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Upload aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                      <div>
                        <h6 className="font-medium">Bulk import</h6>
                        <p className="text-muted-foreground">Upload hours from spreadsheet for multiple entries</p>
                      </div>
                    </div> */}
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="verification">
                <AccordionTrigger>Hour verification process</AccordionTrigger>
                <AccordionContent className="space-y-2 text-sm">
                  <p>Your volunteer hours can be verified through:</p>
                  <ul className="list-disc pl-5 space-y-1 ml-2">
                    {/* <li><strong>Project supervisors:</strong> People you designate as supervisors</li> */}
                    <li>
                      <strong>Organization coordinators:</strong> Official
                      organization administrators
                    </li>
                    <li>
                      <strong>Automatic verification:</strong> For certain
                      project types and organizations
                    </li>
                    <li>
                      <strong>Self-verification:</strong> For individual
                      projects (noted in certificates)
                    </li>
                  </ul>
                  <div className="mt-2 p-2 bg-muted/50 rounded-md text-sm">
                    <strong>Tip:</strong> Verified hours from organizations
                    carry more weight for school requirements
                  </div>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="certificates">
                <AccordionTrigger>Earning certificates</AccordionTrigger>
                <AccordionContent className="space-y-2 text-sm">
                  <p>
                    After completing volunteer work, you automatically receive:
                  </p>
                  <ul className="list-disc pl-5 space-y-1 ml-2">
                    <li>Digital certificate with project details</li>
                    <li>Hour totals and verification status</li>
                    <li>Downloadable PDF for records</li>
                    <li>Shareable links for verification</li>
                  </ul>
                  <Link
                    href="/certificates"
                    className={cn(
                      buttonVariants({
                        variant: "outline",
                        className: "mt-2",
                      }),
                    )}
                  >
                    View my certificates
                  </Link>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      </div>

      <Card id="projects-csv">
        <CardHeader>
          <CardTitle>Data export & import</CardTitle>
          <CardDescription>
            Export your data or import existing volunteer records
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion>
            <AccordionItem value="csv-export">
              <AccordionTrigger>Exporting your data</AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm">
                <p>
                  Export your volunteer hours for reports or school
                  requirements:
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <h6 className="font-medium mb-2">From Dashboard:</h6>
                    <ol className="list-decimal pl-5 space-y-1 text-sm">
                      <li>Go to your Dashboard</li>
                      <li>Click &quot;Export certificates&quot; button</li>
                      <li>Select date range (optional)</li>
                      <li>Download CSV file</li>
                    </ol>
                  </div>
                  <div>
                    <h6 className="font-medium mb-2">
                      From Certificates page:
                    </h6>
                    <ol className="list-decimal pl-5 space-y-1 text-sm">
                      <li>Visit your Certificates page</li>
                      <li>Use export options</li>
                      <li>Print or save individual certificates</li>
                      <li>Bulk export all certificates</li>
                    </ol>
                  </div>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-sm">
                    <strong>Tip:</strong> CSV files can be opened in Excel or
                    Google Sheets for further analysis and school submissions.
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="csv-import">
              <AccordionTrigger>Importing existing records</AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm">
                <p>Upload your existing volunteer hour records:</p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>
                    Prepare your CSV with columns: Date, Hours, Description,
                    Organization
                  </li>
                  <li>Go to Projects → Import Hours</li>
                  <li>Upload your CSV file</li>
                  <li>Review and map columns</li>
                  <li>Confirm import</li>
                </ol>
                <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                  <h6 className="font-medium text-sm mb-1">
                    Required CSV format:
                  </h6>
                  <code className="text-sm bg-background p-1 rounded-md">
                    Date,Hours,Description,Organization
                  </code>
                  <br />
                  <code className="text-sm bg-background p-1 rounded-md">
                    2024-01-15,2.5,&quot;Food bank sorting&quot;,Local Food Bank
                  </code>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="project-management">
              <AccordionTrigger>Managing your projects</AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm">
                <p>Keep your projects organized and up-to-date:</p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <h6 className="font-medium mb-2">Project status:</h6>
                    <ul className="space-y-1 text-sm">
                      <li>
                        <Badge variant="outline" className="mr-1">
                          Planning
                        </Badge>{" "}
                        Project being set up
                      </li>
                      <li>
                        <Badge variant="outline" className="mr-1">
                          Active
                        </Badge>{" "}
                        Currently accepting volunteers
                      </li>
                      <li>
                        <Badge variant="outline" className="mr-1">
                          Completed
                        </Badge>{" "}
                        Project finished
                      </li>
                      <li>
                        <Badge variant="outline" className="mr-1">
                          Cancelled
                        </Badge>{" "}
                        Project cancelled
                      </li>
                    </ul>
                  </div>
                  <div>
                    <h6 className="font-medium mb-2">Project actions:</h6>
                    <ul className="space-y-1 text-sm">
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
