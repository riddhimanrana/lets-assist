"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, Award, Target, Download, FileCheck, BookOpen } from "lucide-react";
import Link from "next/link";

export function SchoolsSection() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            Schools & CSF Programs
          </CardTitle>
          <CardDescription>
            Perfect for California Scholarship Federation and other school volunteer programs
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 p-2 rounded-full">
                  <Award className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">CSF Hour Requirements Made Easy</CardTitle>
                  <CardDescription>
                    Track and verify the volunteer hours required for CSF membership with built-in verification and reporting.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                For Students
              </h4>
              <Accordion type="single" collapsible>
                <AccordionItem value="csf-tracking">
                  <AccordionTrigger>CSF Hour Tracking</AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm">
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>Create projects specifically tagged for CSF requirements</li>
                      <li>Track hours with automatic CSF-compliant documentation</li>
                      <li>Get supervisor verification built into the platform</li>
                      <li>Export CSF-ready reports for school submission</li>
                      <li>Maintain detailed logs of all volunteer activities</li>
                    </ul>
                    <div className="mt-3 p-3 bg-chart-4/10 rounded-lg">
                      <p className="text-xs"><strong>CSF Tip:</strong> Most CSF programs require 10-15 hours per semester with proper documentation and verification.</p>
                    </div>
                  </AccordionContent>
                </AccordionItem>
                
                <AccordionItem value="school-projects">
                  <AccordionTrigger>School-Approved Projects</AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm">
                    <p>Examples of CSF-eligible volunteer work:</p>
                    <div className="grid grid-cols-1 gap-2 mt-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Badge variant="outline">Tutoring Students</Badge>
                        <Badge variant="outline">School Events</Badge>
                        <Badge variant="outline">Community Cleanup</Badge>
                        <Badge variant="outline">Library Help</Badge>
                        <Badge variant="outline">Senior Center</Badge>
                        <Badge variant="outline">Food Banks</Badge>
                        <Badge variant="outline">Animal Shelters</Badge>
                        <Badge variant="outline">Hospital Volunteer</Badge>
                      </div>
                    </div>
                    <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                      <h6 className="font-medium text-xs mb-1">Not CSF Eligible (typically):</h6>
                      <p className="text-xs text-muted-foreground">Family businesses, court-ordered service, or paid work</p>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="csf-documentation">
                  <AccordionTrigger>Proper CSF Documentation</AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <p>Let&apos;s Assist automatically creates CSF-compliant documentation:</p>
                    <div className="space-y-2">
                      <div className="flex items-start gap-2">
                        <FileCheck className="h-4 w-4 mt-1 text-chart-5" />
                        <div>
                          <h6 className="font-medium text-xs">Automatic Requirements</h6>
                          <p className="text-xs text-muted-foreground">Date, time, location, description, and supervisor info</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <Download className="h-4 w-4 mt-1 text-chart-5" />
                        <div>
                          <h6 className="font-medium text-xs">Export Ready</h6>
                          <p className="text-xs text-muted-foreground">CSV and PDF formats accepted by most schools</p>
                        </div>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
            
            <div>
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <Award className="h-4 w-4" />
                For Schools & Advisors
              </h4>
              <Accordion type="single" collapsible>
                <AccordionItem value="school-setup">
                  <AccordionTrigger>Setting Up School Programs</AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm">
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Create a school organization account</li>
                      <li>Set up CSF or other volunteer program requirements</li>
                      <li>Invite students to join your school&apos;s program</li>
                      <li>Monitor student progress and verify hours</li>
                      <li>Generate reports for administrative review</li>
                    </ol>
                    <Button asChild size="sm" className="mt-2">
                      <Link href="/organization/create">Set Up School Program</Link>
                    </Button>
                  </AccordionContent>
                </AccordionItem>
                
                <AccordionItem value="student-monitoring">
                  <AccordionTrigger>Monitoring Student Progress</AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm">
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>Dashboard view of all student volunteer hours</li>
                      <li>Automated alerts for students nearing deadlines</li>
                      <li>Bulk export of student data for school records</li>
                      <li>Integration capabilities with school information systems</li>
                      <li>Individual student progress tracking</li>
                      <li>Verification workflow management</li>
                    </ul>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="verification-workflow">
                  <AccordionTrigger>Student Hour Verification</AccordionTrigger>
                  <AccordionContent className="space-y-3 text-sm">
                    <p>Streamlined verification process for educators:</p>
                    <div className="space-y-2">
                      <div className="p-2 border rounded text-xs">
                        <strong>Step 1:</strong> Students submit hours through their projects
                      </div>
                      <div className="p-2 border rounded text-xs">
                        <strong>Step 2:</strong> System notifies designated school staff
                      </div>
                      <div className="p-2 border rounded text-xs">
                        <strong>Step 3:</strong> Review and approve student submissions
                      </div>
                      <div className="p-2 border rounded text-xs">
                        <strong>Step 4:</strong> Generate verified reports for records
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>

          <Card className="border-chart-4/30 bg-chart-4/5">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="bg-chart-4/10 p-2 rounded-full">
                  <Target className="h-5 w-5 text-chart-4" />
                </div>
                <div>
                  <CardTitle className="text-lg">Quick CSF Setup Guide</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <ol className="list-decimal list-inside space-y-1">
                <li>Create account and select &quot;Student&quot; role during signup</li>
                <li>Join your school&apos;s CSF organization (if available)</li>
                <li>Create a project tagged as &quot;CSF Volunteer Hours&quot;</li>
                <li>Track hours with detailed descriptions of activities</li>
                <li>Get supervisor verification for each volunteer session</li>
                <li>Export final report when ready to submit to school</li>
              </ol>
              <div className="mt-4 flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href="/projects/create">Start CSF Project</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/organization">Find School Program</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Additional CSF Resources */}
          <Card className="border-muted">
            <CardHeader>
              <CardTitle className="text-lg">Common CSF Questions & Resources</CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible>
                <AccordionItem value="csf-requirements">
                  <AccordionTrigger>What are the typical CSF requirements?</AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm">
                    <p>While requirements vary by school, typical CSF volunteer requirements include:</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li><strong>Hours:</strong> 10-15 hours per semester or 20-30 per year</li>
                      <li><strong>Verification:</strong> Adult supervisor signature or verification</li>
                      <li><strong>Documentation:</strong> Date, time, location, and activity description</li>
                      <li><strong>Eligible Activities:</strong> Community service, not personal gain</li>
                      <li><strong>Deadlines:</strong> Usually by specific dates each semester</li>
                    </ul>
                    <div className="mt-2 p-2 bg-muted/50 rounded text-xs">
                      <strong>Note:</strong> Always check with your specific school&apos;s CSF advisor for exact requirements.
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="csf-verification">
                  <AccordionTrigger>How does verification work for CSF?</AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm">
                    <p>Let&apos;s Assist provides multiple verification options that meet CSF standards:</p>
                    <div className="grid md:grid-cols-2 gap-3">
                      <div>
                        <h6 className="font-medium mb-1">Organization Projects:</h6>
                        <ul className="text-xs space-y-1">
                          <li>• Automatic verification by org admins</li>
                          <li>• Official organization letterhead available</li>
                          <li>• Verified organization badges</li>
                        </ul>
                      </div>
                      <div>
                        <h6 className="font-medium mb-1">Individual Projects:</h6>
                        <ul className="text-xs space-y-1">
                          <li>• Supervisor contact information</li>
                          <li>• Digital verification links</li>
                          <li>• Detailed activity logs</li>
                        </ul>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="csf-export">
                  <AccordionTrigger>Exporting CSF Reports</AccordionTrigger>
                  <AccordionContent className="space-y-2 text-sm">
                    <p>Generate school-ready reports in multiple formats:</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Go to Dashboard → Export Certificates</li>
                      <li>Select date range for your CSF period</li>
                      <li>Download CSV for detailed records</li>
                      <li>Print individual certificates if required</li>
                      <li>Submit electronic or printed copies to school</li>
                    </ol>
                    <div className="mt-2 p-2 bg-chart-5/10 rounded text-xs">
                      <strong>Pro Tip:</strong> Export your data regularly throughout the semester rather than waiting until the deadline.
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}
