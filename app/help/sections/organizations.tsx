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
import { Shield, Download, UserRoundCog, Eye, Settings } from "lucide-react";
import Link from "next/link";

export function OrganizationsSection() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Working with organizations</CardTitle>
          <CardDescription>
            Connect with volunteer organizations and manage team projects
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h4 className="font-semibold flex items-center gap-2">
                <UserRoundCog className="h-4 w-4" />
                For Volunteers
              </h4>
              <Accordion>
                <AccordionItem value="join-org">
                  <AccordionTrigger>Joining organizations</AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm">
                    <ol className="list-decimal pl-5 space-y-1">
                      <li>
                        Browse available organizations on the Organizations page
                      </li>
                      <li>Request to join or use invitation code from admin</li>
                      <li>Wait for approval from organization administrator</li>
                      <li>Start participating in organization projects</li>
                    </ol>
                    <Link
                      href="/organization"
                      className={cn(
                        buttonVariants({
                          variant: "outline",
                          className: "mt-2",
                        }),
                      )}
                    >
                      Browse Organizations
                    </Link>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="org-projects">
                  <AccordionTrigger>
                    Organization projects & benefits
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <div className="space-y-2">
                      <h6 className="font-medium">
                        Benefits of organization projects:
                      </h6>
                      <ul className="list-disc pl-5 space-y-1 ml-2">
                        <li>
                          View organization-specific volunteer opportunities
                        </li>
                        <li>Join team projects with other volunteers</li>
                        <li>
                          Automatic hour verification by organization admins
                        </li>
                        <li>Access organization resources and guidelines</li>
                        <li>
                          Higher credibility for school and scholarship
                          applications
                        </li>
                        <li>Networking opportunities with other volunteers</li>
                      </ul>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-sm">
                        <strong>Note:</strong> Verified organizations provide
                        certificates with higher authenticity for academic
                        requirements.
                      </p>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="organization-roles">
                  <AccordionTrigger>
                    Understanding organization roles
                  </AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">Member</Badge>
                        <span className="text-xs">
                          Participate in projects, track hours
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">Staff</Badge>
                        <span className="text-xs">
                          Create projects, verify hours for projects they manage
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="default">Admin</Badge>
                        <span className="text-xs">
                          Full organization management, member oversight
                        </span>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="verified-organizations">
                  <AccordionTrigger>Verified organizations</AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <div className="space-y-2">
                      <p>
                        Verified organizations display a green check badge
                        throughout the platform:
                      </p>
                      <ul className="list-disc pl-5 space-y-1 ml-2">
                        <li>On organization profile pages and cards</li>
                        <li>Next to organization names in project listings</li>
                        <li>In project creator information</li>
                        <li>On volunteer hour certificates</li>
                      </ul>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-sm">
                        <strong>Benefits of verified status:</strong> Enhanced
                        credibility, higher trust from volunteers, and
                        certificates carry more weight for academic
                        requirements.
                      </p>
                    </div>
                    <div className="bg-muted/50 p-3 rounded-lg">
                      <p className="text-sm">
                        <strong>How to get verified:</strong> Contact support
                        with organization documentation, tax-exempt status, or
                        official registration papers.
                      </p>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>

            <div className="space-y-4">
              <h4 className="font-semibold flex items-center gap-2">
                <Shield className="h-4 w-4" />
                For Organization Admins
              </h4>
              <Accordion>
                <AccordionItem value="create-org">
                  <AccordionTrigger>Creating organizations</AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm">
                    <ol className="list-decimal pl-5 space-y-1">
                      <li>Apply to create an organization account</li>
                      <li>
                        Provide organization details and verification documents
                      </li>
                      <li>Set up projects and volunteer opportunities</li>
                      <li>Invite volunteers to join your organization</li>
                      <li>Apply for official verification (optional)</li>
                    </ol>
                    <Link
                      href="/organization/create"
                      className={cn(
                        buttonVariants({
                          variant: "outline",
                          className: "mt-2",
                        }),
                      )}
                    >
                      Create organization
                    </Link>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="manage-volunteers">
                  <AccordionTrigger>
                    Managing volunteers & members
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <div className="space-y-3">
                      <div>
                        <h6 className="font-medium mb-1">Member management:</h6>
                        <ul className="list-disc pl-5 space-y-1 ml-2 text-sm">
                          <li>Review and approve volunteer applications</li>
                          <li>Assign roles (Member, Staff, Admin)</li>
                          <li>View member activity and hours</li>
                          <li>Export member data and reports</li>
                          <li>Remove inactive members</li>
                        </ul>
                      </div>
                      <div>
                        <h6 className="font-medium mb-1">Hour verification:</h6>
                        <ul className="list-disc pl-5 space-y-1 ml-2 text-sm">
                          <li>Verify submitted volunteer hours</li>
                          <li>Bulk approve hours for events</li>
                          <li>Set up automatic verification rules</li>
                          <li>Generate verification reports</li>
                        </ul>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="organization-features">
                  <AccordionTrigger>
                    Advanced organization features
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <div className="grid grid-cols-1 gap-3">
                      <div className="flex items-start gap-3">
                        <Eye
                          aria-hidden="true"
                          className="text-muted-foreground mt-0.5 size-4 shrink-0"
                        />
                        <div>
                          <h6 className="font-medium text-sm">
                            Member Overview
                          </h6>
                          <p className="text-sm text-muted-foreground">
                            View all members, their roles, hours, and activity
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <Download
                          aria-hidden="true"
                          className="text-muted-foreground mt-0.5 size-4 shrink-0"
                        />
                        <div>
                          <h6 className="font-medium text-sm">
                            Export member data
                          </h6>
                          <p className="text-sm text-muted-foreground">
                            Download CSV reports of member hours and
                            participation
                          </p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <Settings
                          aria-hidden="true"
                          className="text-muted-foreground mt-0.5 size-4 shrink-0"
                        />
                        <div>
                          <h6 className="font-medium text-sm">
                            Organization settings
                          </h6>
                          <p className="text-sm text-muted-foreground">
                            Manage organization profile, verification, and
                            preferences
                          </p>
                        </div>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Export and Management Section */}
      <Card id="organization-data-management">
        <CardHeader>
          <CardTitle>Organization data management</CardTitle>
          <CardDescription>
            Export member data, manage hours, and generate reports
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion>
            <AccordionItem value="export-member-data">
              <AccordionTrigger>
                Exporting member data (Admin/Staff only)
              </AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm">
                <p>
                  As an organization admin or staff member, you can export
                  comprehensive member data:
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <h6 className="font-medium mb-2">
                      From organization page:
                    </h6>
                    <ol className="list-decimal pl-5 space-y-1 text-sm">
                      <li>Go to your organization&apos;s page</li>
                      <li>Click on &quot;Members&quot; tab</li>
                      <li>Click &quot;Export members&quot; button</li>
                      <li>Select date range (optional)</li>
                      <li>Download CSV with member hours and details</li>
                    </ol>
                  </div>
                  <div>
                    <h6 className="font-medium mb-2">What&apos;s included:</h6>
                    <ul className="list-disc pl-5 space-y-1 text-sm">
                      <li>Member names and usernames</li>
                      <li>Roles and join dates</li>
                      <li>Total volunteer hours</li>
                      <li>Number of events attended</li>
                      <li>Last activity date</li>
                      <li>Contact information (if permitted)</li>
                    </ul>
                  </div>
                </div>
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-sm">
                    <strong>Privacy Note:</strong> Member exports respect
                    privacy settings and only include data you have permission
                    to access.
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="member-details">
              <AccordionTrigger>
                Viewing individual member details
              </AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm">
                <p>Get detailed information about specific members:</p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Navigate to your organization&apos;s Members tab</li>
                  <li>Click &quot;View details&quot; on any member</li>
                  <li>Review their volunteer history with your organization</li>
                  <li>Export individual member reports if needed</li>
                  <li>Verify or manage their hours</li>
                </ol>
                <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                  <h6 className="font-medium text-sm mb-1">
                    Available actions:
                  </h6>
                  <ul className="text-sm space-y-1">
                    <li>• View detailed hour logs and certificates</li>
                    <li>• Export individual member data</li>
                    <li>• Update member roles</li>
                    <li>• Send verification confirmations</li>
                  </ul>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="organization-analytics">
              <AccordionTrigger>
                Organization analytics & overview
              </AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm">
                <p>
                  Understanding your organization&apos;s impact and activity:
                </p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <h6 className="font-medium mb-2">Overview tab metrics:</h6>
                    <ul className="list-disc pl-5 space-y-1 text-sm">
                      <li>Total active members</li>
                      <li>Admin and staff counts</li>
                      <li>Project statistics (upcoming, completed)</li>
                      <li>Recent activity feed</li>
                      <li>Quick access to create projects</li>
                    </ul>
                  </div>
                  <div>
                    <h6 className="font-medium mb-2">Projects tab features:</h6>
                    <ul className="list-disc pl-5 space-y-1 text-sm">
                      <li>View all organization projects</li>
                      <li>Filter by status and date</li>
                      <li>Create new projects</li>
                      <li>Manage project assignments</li>
                      <li>Track project completion rates</li>
                    </ul>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="verification-badges">
              <AccordionTrigger>
                Organization verification & trust badges
              </AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm">
                <p>
                  Getting your organization verified increases trust and
                  credibility:
                </p>
                <div className="space-y-3">
                  <div className="rounded-lg border p-3">
                    <h6 className="font-medium text-sm mb-1 flex items-center gap-1">
                      <Badge variant="success">Verified</Badge>
                      Organization Benefits
                    </h6>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• Higher trust from volunteers and schools</li>
                      <li>• Enhanced visibility in organization listings</li>
                      <li>• Official verification badge on certificates</li>
                      <li>• Priority in search results</li>
                    </ul>
                  </div>
                  <div className="text-sm">
                    <strong>How to Apply:</strong> Go to your organization
                    settings and click &quot;Apply for verification&quot; to
                    submit required documentation.
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
