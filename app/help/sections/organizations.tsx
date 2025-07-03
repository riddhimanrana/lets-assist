"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, Shield, Download, FileSpreadsheet, UserRoundCog, Eye, Settings } from "lucide-react";
import Link from "next/link";

export function OrganizationsSection() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Working with Organizations
          </CardTitle>
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
              <Accordion type="single" collapsible>
                <AccordionItem value="join-org">
                  <AccordionTrigger>Joining Organizations</AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm">
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Browse available organizations on the Organizations page</li>
                      <li>Request to join or use invitation code from admin</li>
                      <li>Wait for approval from organization administrator</li>
                      <li>Start participating in organization projects</li>
                    </ol>
                    <Button asChild size="sm" variant="outline" className="mt-2">
                      <Link href="/organization">Browse Organizations</Link>
                    </Button>
                  </AccordionContent>
                </AccordionItem>
                
                <AccordionItem value="org-projects">
                  <AccordionTrigger>Organization Projects & Benefits</AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <div className="space-y-2">
                      <h6 className="font-medium">Benefits of Organization Projects:</h6>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>View organization-specific volunteer opportunities</li>
                        <li>Join team projects with other volunteers</li>
                        <li>Automatic hour verification by organization admins</li>
                        <li>Access organization resources and guidelines</li>
                        <li>Higher credibility for school and scholarship applications</li>
                        <li>Networking opportunities with other volunteers</li>
                      </ul>
                    </div>
                    <div className="bg-primary/10 p-3 rounded-lg">
                      <p className="text-xs"><strong>Note:</strong> Verified organizations provide certificates with higher authenticity for academic requirements.</p>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="organization-roles">
                  <AccordionTrigger>Understanding Organization Roles</AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">Member</Badge>
                        <span className="text-xs">Participate in projects, track hours</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">Staff</Badge>
                        <span className="text-xs">Create projects, verify hours for projects they manage</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="default">Admin</Badge>
                        <span className="text-xs">Full organization management, member oversight</span>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="verified-organizations">
                  <AccordionTrigger>Verified Organizations</AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <div className="space-y-2">
                      <p>Verified organizations display a blue check badge throughout the platform:</p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>On organization profile pages and cards</li>
                        <li>Next to organization names in project listings</li>
                        <li>In project creator information</li>
                        <li>On volunteer hour certificates</li>
                      </ul>
                    </div>
                    <div className="bg-primary/10 p-3 rounded-lg">
                      <p className="text-xs"><strong>Benefits of verified status:</strong> Enhanced credibility, higher trust from volunteers, and certificates carry more weight for academic requirements.</p>
                    </div>
                    <div className="bg-muted/50 p-3 rounded-lg">
                      <p className="text-xs"><strong>How to get verified:</strong> Contact support with organization documentation, tax-exempt status, or official registration papers.</p>
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
              <Accordion type="single" collapsible>
                <AccordionItem value="create-org">
                  <AccordionTrigger>Creating Organizations</AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm">
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Apply to create an organization account</li>
                      <li>Provide organization details and verification documents</li>
                      <li>Set up projects and volunteer opportunities</li>
                      <li>Invite volunteers to join your organization</li>
                      <li>Apply for official verification (optional)</li>
                    </ol>
                    <Button asChild size="sm" className="mt-2">
                      <Link href="/organization/create">Create Organization</Link>
                    </Button>
                  </AccordionContent>
                </AccordionItem>
                
                <AccordionItem value="manage-volunteers">
                  <AccordionTrigger>Managing Volunteers & Members</AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <div className="space-y-3">
                      <div>
                        <h6 className="font-medium mb-1">Member Management:</h6>
                        <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
                          <li>Review and approve volunteer applications</li>
                          <li>Assign roles (Member, Staff, Admin)</li>
                          <li>View member activity and hours</li>
                          <li>Export member data and reports</li>
                          <li>Remove inactive members</li>
                        </ul>
                      </div>
                      <div>
                        <h6 className="font-medium mb-1">Hour Verification:</h6>
                        <ul className="list-disc list-inside space-y-1 ml-2 text-xs">
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
                  <AccordionTrigger>Advanced Organization Features</AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <div className="grid grid-cols-1 gap-3">
                      <div className="flex items-start gap-3 p-2 border rounded">
                        <Eye className="h-4 w-4 mt-1 text-primary" />
                        <div>
                          <h6 className="font-medium text-xs">Member Overview</h6>
                          <p className="text-xs text-muted-foreground">View all members, their roles, hours, and activity</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 p-2 border rounded">
                        <Download className="h-4 w-4 mt-1 text-primary" />
                        <div>
                          <h6 className="font-medium text-xs">Export Member Data</h6>
                          <p className="text-xs text-muted-foreground">Download CSV reports of member hours and participation</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 p-2 border rounded">
                        <Settings className="h-4 w-4 mt-1 text-primary" />
                        <div>
                          <h6 className="font-medium text-xs">Organization Settings</h6>
                          <p className="text-xs text-muted-foreground">Manage organization profile, verification, and preferences</p>
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
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Organization Data Management
          </CardTitle>
          <CardDescription>
            Export member data, manage hours, and generate reports
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible>
            <AccordionItem value="export-member-data">
              <AccordionTrigger>Exporting Member Data (Admin/Staff Only)</AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm">
                <p>As an organization admin or staff member, you can export comprehensive member data:</p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <h6 className="font-medium mb-2">From Organization Page:</h6>
                    <ol className="list-decimal list-inside space-y-1 text-xs">
                      <li>Go to your organization&apos;s page</li>
                      <li>Click on &quot;Members&quot; tab</li>
                      <li>Click &quot;Export Members&quot; button</li>
                      <li>Select date range (optional)</li>
                      <li>Download CSV with member hours and details</li>
                    </ol>
                  </div>
                  <div>
                    <h6 className="font-medium mb-2">What&apos;s Included:</h6>
                    <ul className="list-disc list-inside space-y-1 text-xs">
                      <li>Member names and usernames</li>
                      <li>Roles and join dates</li>
                      <li>Total volunteer hours</li>
                      <li>Number of events attended</li>
                      <li>Last activity date</li>
                      <li>Contact information (if permitted)</li>
                    </ul>
                  </div>
                </div>
                <div className="bg-primary/10 p-3 rounded-lg">
                  <p className="text-xs"><strong>Privacy Note:</strong> Member exports respect privacy settings and only include data you have permission to access.</p>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="member-details">
              <AccordionTrigger>Viewing Individual Member Details</AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm">
                <p>Get detailed information about specific members:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Navigate to your organization&apos;s Members tab</li>
                  <li>Click &quot;View Details&quot; on any member</li>
                  <li>Review their volunteer history with your organization</li>
                  <li>Export individual member reports if needed</li>
                  <li>Verify or manage their hours</li>
                </ol>
                <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                  <h6 className="font-medium text-xs mb-1">Available Actions:</h6>
                  <ul className="text-xs space-y-1">
                    <li>• View detailed hour logs and certificates</li>
                    <li>• Export individual member data</li>
                    <li>• Update member roles</li>
                    <li>• Send verification confirmations</li>
                  </ul>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="organization-analytics">
              <AccordionTrigger>Organization Analytics & Overview</AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm">
                <p>Understanding your organization&apos;s impact and activity:</p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <h6 className="font-medium mb-2">Overview Tab Metrics:</h6>
                    <ul className="list-disc list-inside space-y-1 text-xs">
                      <li>Total active members</li>
                      <li>Admin and staff counts</li>
                      <li>Project statistics (upcoming, completed)</li>
                      <li>Recent activity feed</li>
                      <li>Quick access to create projects</li>
                    </ul>
                  </div>
                  <div>
                    <h6 className="font-medium mb-2">Projects Tab Features:</h6>
                    <ul className="list-disc list-inside space-y-1 text-xs">
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
              <AccordionTrigger>Organization Verification & Trust Badges</AccordionTrigger>
              <AccordionContent className="space-y-3 text-sm">
                <p>Getting your organization verified increases trust and credibility:</p>
                <div className="space-y-3">
                  <div className="p-3 border rounded-lg">
                    <h6 className="font-medium text-xs mb-1 flex items-center gap-1">
                      <Badge variant="outline" className="bg-chart-5/5 border-chart-5/20 text-chart-5">
                        Verified
                      </Badge>
                      Organization Benefits
                    </h6>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>• Higher trust from volunteers and schools</li>
                      <li>• Enhanced visibility in organization listings</li>
                      <li>• Official verification badge on certificates</li>
                      <li>• Priority in search results</li>
                    </ul>
                  </div>
                  <div className="text-xs">
                    <strong>How to Apply:</strong> Go to your organization settings and click &quot;Apply for Verification&quot; to submit required documentation.
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
