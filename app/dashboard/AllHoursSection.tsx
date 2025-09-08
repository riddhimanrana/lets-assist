"use client";

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Calendar, 
  Clock, 
  Award, 
  TicketCheck,
  FileCheck,
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  CircleCheck,
  UserCheck
} from "lucide-react";
import { format, parseISO } from "date-fns";
import Link from "next/link";

interface Certificate {
  id: string;
  project_title: string;
  creator_name: string | null;
  is_certified: boolean;
  type?: "platform" | "self-reported"; // Optional for backward compatibility
  event_start: string;
  event_end: string;
  volunteer_email: string | null;
  organization_name: string | null;
  project_id: string | null;
  schedule_id: string | null;
  issued_at: string;
  signup_id: string | null;
  volunteer_name: string | null;
  project_location: string | null;
}

interface AllHoursSectionProps {
  certificates: Certificate[];
}

function formatTime12Hour(time24: string): string {
  const [hours, minutes] = time24.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

// Client-side utility functions
function calculateDecimalHours(startTimeISO: string, endTimeISO: string): number {
  const start = new Date(startTimeISO);
  const end = new Date(endTimeISO);
  const diffMs = end.getTime() - start.getTime();
  return diffMs / (1000 * 60 * 60); // Convert milliseconds to hours
}

function formatTotalDuration(totalHours: number): string {
  const hours = Math.floor(totalHours);
  const minutes = Math.round((totalHours - hours) * 60);
  
  if (hours === 0 && minutes === 0) return "0m";
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function AllHoursSection({ certificates }: AllHoursSectionProps) {
  
  // Separate platform and self-reported certificates (default to platform for backward compatibility)
  const verifiedCertificates = certificates.filter(cert => (cert.type || "platform") === "platform");
  const selfReportedCertificates = certificates.filter(cert => cert.type === "self-reported");
  
  const totalVerified = verifiedCertificates.length;
  const totalSelfReported = selfReportedCertificates.length;

  const CertificateItem = ({ cert, isSelfReported = false }: { cert: Certificate; isSelfReported?: boolean }) => {
    const durationHours = calculateDecimalHours(cert.event_start, cert.event_end);
    const formattedDuration = formatTotalDuration(durationHours);

    return (
      <div className="border rounded-lg p-3 sm:p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
        <div className="flex-1 space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            {isSelfReported ? (
              <Badge variant="secondary" className="text-xs bg-chart-4/10 text-chart-4 dark:bg-chart-4/10 dark:text-chart-4">
                Self-Reported
              </Badge>
            ) : (
              <Badge variant="default" className="text-xs">Platform</Badge>
            )}
                        {!isSelfReported && cert.is_certified && (
              <Badge variant="default" className="text-xs bg-emerald-600 hover:bg-emerald-700">
                <Award className="h-3 w-3 mr-1" /> Official Org
              </Badge>
            )}
          </div>
          <div className="font-medium text-sm sm:text-base">{cert.project_title}</div>
          <p className="text-xs sm:text-sm text-muted-foreground truncate">
            {cert.organization_name || cert.creator_name || "Unknown Organizer"}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground pt-1">
            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {format(parseISO(cert.event_start), "MMM d, yyyy")}</span>
            {formattedDuration !== "0m" && (
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formattedDuration}</span>
            )}
          </div>
        </div>
        <div className="flex-shrink-0 w-full sm:w-auto">
          <Button size="sm" variant="outline" asChild className="w-full sm:w-auto">
            <Link href={`/certificates/${cert.id}`} target="_blank" rel="noopener noreferrer">
              <TicketCheck className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">View Certificate</span>
              <span className="sm:hidden">Certificate</span>
            </Link>
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Verified Hours Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CircleCheck className="h-5 w-5 text-primary flex-shrink-0" />
            <CardTitle>Let&apos;s Assist Platform Hours</CardTitle>
            <Badge variant="secondary">{totalVerified}</Badge>
          </div>
          <CardDescription>Hours from Let&apos;s Assist platform projects and organizations</CardDescription>
        </CardHeader>
        <CardContent>
          {verifiedCertificates.length > 0 ? (
            verifiedCertificates.length <= 3 ? (
              <div className="space-y-3 sm:space-y-4">
                {verifiedCertificates.map((cert) => (
                  <CertificateItem key={cert.id} cert={cert} />
                ))}
              </div>
            ) : (
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-3 sm:space-y-4">
                  {verifiedCertificates.map((cert) => (
                    <CertificateItem key={cert.id} cert={cert} />
                  ))}
                </div>
              </ScrollArea>
            )
          ) : (
            <div className="flex flex-col items-center justify-center py-8 sm:py-10 text-center">
              <FileCheck className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground/30 mb-3" />
              <h3 className="font-medium text-sm sm:text-base">No Verified Hours Yet</h3>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-xs">
                Complete Let&apos;s Assist volunteer opportunities to earn verified certificates.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Self-Reported Hours Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-chart-4 dark:text-chart-4" />
            <CardTitle>Self-Reported Hours</CardTitle>
            <Badge variant="secondary">{totalSelfReported}</Badge>
          </div>
          <CardDescription>Volunteer hours you&apos;ve added from activities outside Let&apos;s Assist</CardDescription>
        </CardHeader>
        <CardContent>
          {selfReportedCertificates.length > 0 ? (
            selfReportedCertificates.length <= 3 ? (
              <div className="space-y-3 sm:space-y-4">
                {selfReportedCertificates.map((cert) => (
                  <CertificateItem key={cert.id} cert={cert} isSelfReported />
                ))}
              </div>
            ) : (
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-3 sm:space-y-4">
                  {selfReportedCertificates.map((cert) => (
                    <CertificateItem key={cert.id} cert={cert} isSelfReported />
                  ))}
                </div>
              </ScrollArea>
            )
          ) : (
            <div className="flex flex-col items-center justify-center py-8 sm:py-10 text-center">
              <AlertTriangle className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground/30 mb-3" />
              <h3 className="font-medium text-sm sm:text-base">No Self-Reported Hours Yet</h3>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-xs">
                Add volunteer hours from activities outside Let&apos;s Assist.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
