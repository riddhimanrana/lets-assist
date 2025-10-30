"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Award, Download, Eye, Share2, Printer, BadgeCheck, MapPin } from "lucide-react";
import Link from "next/link";

export function CertificatesSection() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-5 w-5" />
            Understanding Certificates
          </CardTitle>
          <CardDescription>
            Learn how certificates work and how to use them for verification
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="font-semibold">What are Certificates?</h4>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-chart-5" />
                  Digital proof of your volunteer work
                </li>
                <li className="flex items-center gap-2">
                  <BadgeCheck className="h-4 w-4 text-chart-5" />
                  Automatically generated after completing projects
                </li>
                <li className="flex items-center gap-2">
                  <Share2 className="h-4 w-4 text-chart-5" />
                  Shareable links for verification
                </li>
                <li className="flex items-center gap-2">
                  <Download className="h-4 w-4 text-chart-5" />
                  Downloadable for school/scholarship applications
                </li>
              </ul>
            </div>
            <div className="space-y-3">
              <h4 className="font-semibold">Certificate Types</h4>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-chart-5/5 border-chart-5/20 text-chart-5">
                    <BadgeCheck className="h-3 w-3 mr-1" />
                    Certified
                  </Badge>
                  <span className="text-sm text-muted-foreground">From verified organizations</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">Participated</Badge>
                  <span className="text-sm text-muted-foreground">Individual or unverified projects</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Accordion type="single" collapsible className="w-full space-y-4">
        <AccordionItem value="viewing-certificates" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Viewing Your Certificates
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 text-sm pt-4">
            <p>Access your certificates from multiple locations:</p>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h6 className="font-medium mb-2">Certificates Page:</h6>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Click &quot;Certificates&quot; in the main navigation</li>
                  <li>Browse all your certificates in a grid view</li>
                  <li>Filter by date, organization, or project</li>
                  <li>Sort by newest, oldest, or hours</li>
                </ol>
              </div>
              <div>
                <h6 className="font-medium mb-2">Dashboard Access:</h6>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>View recent certificates on your dashboard</li>
                  <li>See certificate count and total hours</li>
                  <li>Quick export options available</li>
                  <li>Links to full certificates page</li>
                </ol>
              </div>
            </div>
            <Button asChild size="sm" className="mt-2">
              <Link href="/certificates">View My Certificates</Link>
            </Button>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="certificate-details" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4" />
              What&apos;s in a Certificate
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 text-sm pt-4">
            <p>Each certificate contains detailed information about your volunteer work:</p>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h6 className="font-medium mb-2">Basic Information:</h6>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Project title and description</li>
                  <li>Organization name (if applicable)</li>
                  <li>Volunteer hours completed</li>
                  <li>Date and time of service</li>
                  <li>Location of volunteer work</li>
                </ul>
              </div>
              <div>
                <h6 className="font-medium mb-2">Verification Details:</h6>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Certification status (Certified/Participated)</li>
                  <li>Issuing organization information</li>
                  <li>Unique certificate ID</li>
                  <li>Issue date and verification status</li>
                  <li>QR code for quick verification</li>
                </ul>
              </div>
            </div>
            <div className="bg-muted/50 p-3 rounded-lg">
              <p className="text-xs"><strong>Note:</strong> Certificates from verified organizations carry more weight for academic and scholarship applications.</p>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="sharing-certificates" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Share2 className="h-4 w-4" />
              Sharing & Verification
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 text-sm pt-4">
            <p>Multiple ways to share your certificates for verification:</p>
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-2 border rounded">
                <Share2 className="h-4 w-4 mt-1 text-primary" />
                <div>
                  <h6 className="font-medium text-xs">Direct Links</h6>
                  <p className="text-xs text-muted-foreground">Each certificate has a unique URL that can be shared with schools, employers, or scholarship committees</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-2 border rounded">
                <Download className="h-4 w-4 mt-1 text-primary" />
                <div>
                  <h6 className="font-medium text-xs">PDF Downloads</h6>
                  <p className="text-xs text-muted-foreground">Download individual certificates as PDF files for printing or email attachments</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-2 border rounded">
                <Printer className="h-4 w-4 mt-1 text-primary" />
                <div>
                  <h6 className="font-medium text-xs">Print Options</h6>
                  <p className="text-xs text-muted-foreground">Print single certificates or bulk print multiple certificates for physical submission</p>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="exporting-certificates" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Exporting Certificate Data
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 text-sm pt-4">
            <p>Export your certificates in various formats for different purposes:</p>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h6 className="font-medium mb-2">From Dashboard:</h6>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Go to your Dashboard</li>
                  <li>Find the &quot;Export Certificates&quot; section</li>
                  <li>Select date range (optional)</li>
                  <li>Click &quot;Export CSV&quot;</li>
                  <li>Save the file with all certificate details</li>
                </ol>
              </div>
              <div>
                <h6 className="font-medium mb-2">From Certificates Page:</h6>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Visit your Certificates page</li>
                  <li>Use filter options to select specific certificates</li>
                  <li>Use the &quot;Print&quot; button for bulk printing</li>
                  <li>Export summary data for reporting</li>
                </ol>
              </div>
            </div>
            <div className="bg-chart-3/20 p-3 rounded-lg">
              <h6 className="font-medium text-xs mb-1">CSV Export Includes:</h6>
              <ul className="text-xs space-y-1">
                <li>• Certificate ID and project details</li>
                <li>• Organization and verification status</li>
                <li>• Hours completed and event dates</li>
                <li>• Location and supervisor information</li>
                <li>• Summary statistics and totals</li>
              </ul>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="certificate-verification" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <BadgeCheck className="h-4 w-4" />
              Verification for Schools & Organizations
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 text-sm pt-4">
            <p>How others can verify your volunteer work:</p>
            <div className="space-y-3">
              <div className="p-3 border rounded-lg">
                <h6 className="font-medium text-xs mb-2 flex items-center gap-1">
                  <Badge variant="outline" className="bg-chart-5/5 border-chart-5/20 text-chart-5">
                    <BadgeCheck className="h-3 w-3 mr-1" />
                    Verified Organizations
                  </Badge>
                </h6>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>• Official verification badge visible on certificates</li>
                  <li>• Organization contact information provided</li>
                  <li>• Higher credibility for academic requirements</li>
                  <li>• Direct verification possible through organization</li>
                </ul>
              </div>
              <div className="p-3 border rounded-lg">
                <h6 className="font-medium text-xs mb-2">All Certificates Include:</h6>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>• Unique certificate ID for tracking</li>
                  <li>• QR codes for instant verification</li>
                  <li>• Detailed activity logs and timestamps</li>
                  <li>• Supervisor or organization contact details</li>
                  <li>• Platform verification through Let&apos;s Assist</li>
                </ul>
              </div>
            </div>
            <div className="mt-3 p-2 bg-muted/50 rounded text-xs">
              <strong>For Verifiers:</strong> Anyone can verify a certificate by visiting the unique URL or scanning the QR code to see full details and confirm authenticity.
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="certificate-tips" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Tips for Better Certificates
            </div>
          </AccordionTrigger>
          <AccordionContent className="space-y-3 text-sm pt-4">
            <p>Make your certificates more valuable and credible:</p>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h6 className="font-medium mb-2">When Creating Projects:</h6>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Include detailed project descriptions</li>
                  <li>Add specific location information</li>
                  <li>Set clear start and end times</li>
                  <li>Invite supervisors for verification</li>
                  <li>Choose appropriate project categories</li>
                </ul>
              </div>
              <div>
                <h6 className="font-medium mb-2">For Better Verification:</h6>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Join verified organizations when possible</li>
                  <li>Provide supervisor contact information</li>
                  <li>Document your work with photos (when appropriate)</li>
                  <li>Track hours consistently and accurately</li>
                  <li>Keep detailed notes about your activities</li>
                </ul>
              </div>
            </div>
            <div className="bg-primary/10 p-3 rounded-lg">
              <p className="text-xs"><strong>Remember:</strong> The more detailed and verified your volunteer work is, the more valuable your certificates become for school applications, scholarships, and future opportunities.</p>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
