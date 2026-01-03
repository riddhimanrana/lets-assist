"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/NoAvatar";
import { Clock, Award, Calendar, BadgeCheck, ExternalLink, Download, FileText, CheckCheck } from "lucide-react";
import { getMemberEventDetails } from "./member-hours-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";

interface MemberEventDetail {
  id: string;
  projectTitle: string;
  eventDate: string;
  hours: number;
  isCertified: boolean;
  organizationName: string;
}

type MemberProfileShape = {
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

interface MemberDetailsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  member: {
    id: string;
    user_id: string;
    role: string;
    joined_at: string;
    profiles?: MemberProfileShape | MemberProfileShape[] | null;
  } | null;
  organizationId: string;
}

// Helper function to format hours as "Xh Ym"
function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export default function MemberDetailsDialog({
  isOpen,
  onClose,
  member,
  organizationId
}: MemberDetailsDialogProps) {
  const [events, setEvents] = useState<MemberEventDetail[]>([]);
  const [totalHours, setTotalHours] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  useEffect(() => {
    if (isOpen && member) {
      fetchMemberDetails();
    }
  }, [isOpen, member, organizationId, dateRange]);

  const fetchMemberDetails = async () => {
    if (!member) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const dateRangeParam = dateRange?.from && dateRange?.to 
        ? { from: dateRange.from, to: dateRange.to }
        : undefined;
      const result = await getMemberEventDetails(organizationId, member.user_id, dateRangeParam);
      
      if (result.error) {
        setError(result.error);
      } else {
        setEvents(result.events);
        setTotalHours(result.totalHours);
      }
    } catch (err) {
      console.error("Error fetching member details:", err);
      setError("Failed to load member details");
    } finally {
      setLoading(false);
    }
  };

  const handleExportMemberData = () => {
    if (!member || events.length === 0) {
      toast.error("No data to export");
      return;
    }

    setIsExporting(true);
    
    try {
      const profile = Array.isArray(member?.profiles) ? member.profiles[0] : member?.profiles;
      const memberName = profile?.full_name || "Unknown User";
      const username = profile?.username || "";
      
      // Prepare comprehensive CSV data
      const headers = [
        "Member Name", "Username", "Role", "Joined Date",
        "Event Title", "Event Date", "Hours", "Status", 
        "Certificate ID", "Certificate Link"
      ];
      const csvRows = [headers.join(",")];
      
      events.forEach(event => {
        const row = [
          `"${memberName}"`,
          username,
          member.role,
          `"${format(new Date(member.joined_at), "MMM d, yyyy")}"`,
          `"${event.projectTitle}"`,
          `"${format(new Date(event.eventDate), "MMM d, yyyy")}"`,
          formatHours(event.hours),
          event.isCertified ? "Certified" : "Completed",
          event.id,
          event.isCertified ? `${window.location.origin}/certificates/${event.id}` : "N/A"
        ].join(",");
        csvRows.push(row);
      });
      
      // Add summary section
    //   csvRows.push("");
    //   csvRows.push("=== SUMMARY ===");
      csvRows.push(`"Total Hours","${formatHours(totalHours)}"`);
      csvRows.push(`"Total Events","${events.length}"`);
      csvRows.push(`"Certified Events","${events.filter(e => e.isCertified).length}"`);
      csvRows.push(`"Member Since","${format(new Date(member.joined_at), "MMM d, yyyy")}"`);
      
      const csvData = csvRows.join("\n");
      const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      // Create filename with date range if applicable
      const today = new Date().toISOString().split('T')[0];
      const cleanName = memberName.replace(/\s+/g, '-').toLowerCase();
      let filename = `${cleanName}-volunteer-data-${today}`;
      if (dateRange?.from && dateRange?.to) {
        const fromDate = format(dateRange.from, "yyyy-MM-dd");
        const toDate = format(new Date(dateRange.to.getTime() - 24 * 60 * 60 * 1000), "yyyy-MM-dd");
        filename = `${cleanName}-volunteer-data-${fromDate}-to-${toDate}`;
      } else {
        filename = `${cleanName}-volunteer-data-lifetime-${today}`;
      }
      a.download = `${filename}.csv`;
      
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast.success(`${memberName}'s volunteer data exported successfully`);
    } catch (error) {
      console.error("Error exporting member data:", error);
      toast.error("Failed to export member data");
    } finally {
      setIsExporting(false);
    }
  };

  if (!member) return null;

  const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;

  return (
    <Dialog open={isOpen} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-4xl w-[calc(100vw-1rem)] sm:w-[92vw] max-h-[85vh] sm:max-h-[90vh] overflow-hidden flex flex-col p-0">
        {/* Fixed Header */}
        <DialogHeader className="space-y-2 sm:space-y-3 p-3 sm:p-6 pb-2 sm:pb-4 border-b flex-shrink-0">
          <DialogTitle className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
              <Avatar className="h-9 w-9 sm:h-12 sm:w-12 border border-border flex-shrink-0">
                <AvatarImage
                  src={profile?.avatar_url || undefined}
                  alt={profile?.full_name || ""}
                />
                <AvatarFallback className="bg-primary/10 text-primary text-sm sm:text-base">
                  <NoAvatar fullName={profile?.full_name || ""} />
                </AvatarFallback>
              </Avatar>
              <div className="text-left min-w-0 flex-1">
                <h2 className="text-sm sm:text-xl font-semibold leading-tight truncate">
                  {profile?.full_name || "Unknown User"}
                </h2>
                <p className="text-[11px] sm:text-sm font-mono font-normal text-muted-foreground truncate">
                  @{profile?.username || ""} • {member.role}
                </p>
              </div>
            </div>
            {events.length > 0 && (
              <Button
                onClick={handleExportMemberData}
                disabled={isExporting}
                variant="outline"
                size="sm"
                className="gap-1.5 sm:gap-2 self-start sm:self-center flex-shrink-0 h-8 px-2 sm:px-3 text-xs sm:text-sm"
              >
                {isExporting ? (
                  <>
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                    <span className="hidden sm:inline">Exporting...</span>
                    <span className="sm:hidden">...</span>
                  </>
                ) : (
                  <>
                    <Download className="h-3 w-3" />
                    <span className="hidden sm:inline">Export Data</span>
                    <span className="sm:hidden">Export</span>
                  </>
                )}
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 pt-3 sm:pt-4 space-y-3 sm:space-y-6">
          {/* Date Range Filter */}
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 sm:items-center border-b pb-3 sm:pb-4">
            <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
              Filter by date:
            </span>
            <DateRangePicker
              value={dateRange}
              onChange={setDateRange}
              placeholder={dateRange?.from ? undefined : "Lifetime (All Time)"}
              showQuickSelect={true}
              className="w-full sm:w-auto text-xs sm:text-sm"
            />
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
            <Card className="overflow-hidden">
              <CardHeader className="pb-0.5 sm:pb-2 px-2 sm:px-4 pt-2 sm:pt-4">
                <CardTitle className="text-[10px] sm:text-sm font-medium flex items-center gap-1 sm:gap-2">
                  <Clock className="h-3 w-3 sm:h-4 sm:w-4 text-primary flex-shrink-0" />
                  <span className="truncate">Hours</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 sm:px-4 pb-2 sm:pb-4">
                <div className="text-base sm:text-2xl font-bold text-primary truncate">
                  {loading ? <Skeleton className="h-4 sm:h-8 w-8 sm:w-16" /> : formatHours(totalHours)}
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader className="pb-0.5 sm:pb-2 px-2 sm:px-4 pt-2 sm:pt-4">
                <CardTitle className="text-[10px] sm:text-sm font-medium flex items-center gap-1 sm:gap-2">
                  <Award className="h-3 w-3 sm:h-4 sm:w-4 text-primary flex-shrink-0" />
                  <span className="truncate">Events</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 sm:px-4 pb-2 sm:pb-4">
                <div className="text-base sm:text-2xl font-bold truncate">
                  {loading ? <Skeleton className="h-4 sm:h-8 w-6 sm:w-16" /> : events.length}
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader className="pb-0.5 sm:pb-2 px-2 sm:px-4 pt-2 sm:pt-4">
                <CardTitle className="text-[10px] sm:text-sm font-medium flex items-center gap-1 sm:gap-2">
                  <Calendar className="h-3 w-3 sm:h-4 sm:w-4 text-primary flex-shrink-0" />
                  <span className="truncate">Joined</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 sm:px-4 pb-2 sm:pb-4">
                <div className="text-[10px] sm:text-sm font-medium truncate">
                  {format(new Date(member.joined_at), "MMM yyyy")}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Events Table */}
          <div className="space-y-2 sm:space-y-3">
            <h3 className="text-xs sm:text-lg font-semibold">Event Participation</h3>
            
            {error && (
              <div className="text-center p-2.5 sm:p-4 text-red-500 bg-red-50 rounded-lg text-xs sm:text-sm">
                {error}
              </div>
            )}

            {loading ? (
              <div className="space-y-1.5 sm:space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-10 sm:h-16 w-full" />
                ))}
              </div>
            ) : events.length > 0 ? (
              <>
                {/* Desktop Table */}
                <div className="hidden lg:block border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="font-semibold">Event</TableHead>
                        <TableHead className="font-semibold">Date</TableHead>
                        <TableHead className="font-semibold">Hours</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                        <TableHead className="font-semibold">Certificate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {events.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell>
                            <div className="font-medium">{event.projectTitle}</div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm text-muted-foreground">
                              {format(new Date(event.eventDate), "MMM d, yyyy")}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">
                              {formatHours(event.hours)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {event.isCertified ? (
                                <Badge variant="default" className="gap-1">
                                  <BadgeCheck className="h-3 w-3" />
                                  Certified
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="gap-1">
                                  <CheckCheck className="h-3 w-3" />
                                  Completed
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {event? (
                                <Button
                                  asChild
                                  variant="ghost"
                                  size="sm"
                                  className="gap-1 h-7 px-2"
                                >
                                  <a 
                                    href={`/certificates/${event.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1"
                                  >
                                    <FileText className="h-3 w-3" />
                                    View
                                    <ExternalLink className="h-2 w-2" />
                                  </a>
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">No certificate</span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile/Tablet Cards */}
                <div className="lg:hidden space-y-2 sm:space-y-3">
                  {events.map((event) => (
                    <Card key={event.id} className="p-2.5 sm:p-4">
                      <div className="space-y-2 sm:space-y-3">
                        <div className="flex justify-between items-start gap-2">
                          <h4 className="font-medium text-xs sm:text-sm leading-tight flex-1 min-w-0 line-clamp-2">
                            {event.projectTitle}
                          </h4>
                          {event.isCertified ? (
                            <Badge variant="default" className="gap-0.5 sm:gap-1 text-[10px] sm:text-xs flex-shrink-0 px-1.5 sm:px-2">
                              <BadgeCheck className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                              <span className="hidden sm:inline">Certified</span>
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-0.5 sm:gap-1 text-[10px] sm:text-xs flex-shrink-0 px-1.5 sm:px-2">
                              <CheckCheck className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                              <span className="hidden sm:inline">Completed</span>
                            </Badge>
                          )}
                        </div>
                        
                        <div className="flex justify-between items-center text-xs sm:text-sm">
                          <div className="flex items-center gap-2 sm:gap-4">
                            <div className="text-muted-foreground text-[10px] sm:text-sm">
                              {format(new Date(event.eventDate), "MMM d, yyyy")}
                            </div>
                            <div className="font-semibold text-primary text-xs sm:text-sm">
                              {formatHours(event.hours)}
                            </div>
                          </div>
                          
                          {event.isCertified && (
                            <Button
                              asChild
                              variant="ghost"
                              size="sm"
                              className="gap-1 h-6 sm:h-7 px-1.5 sm:px-2 text-[10px] sm:text-xs"
                            >
                              <a 
                                href={`/certificates/${event.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1"
                              >
                                <FileText className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                                <span className="hidden sm:inline">Certificate</span>
                                <span className="sm:hidden">Cert</span>
                                <ExternalLink className="h-2 w-2" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </>
            ) : !loading && (
              <div className="text-center p-4 sm:p-8 bg-muted/20 rounded-lg">
                <Award className="h-8 w-8 sm:h-12 sm:w-12 mx-auto mb-2 sm:mb-4 text-muted-foreground" />
                <h4 className="text-sm sm:text-lg font-medium mb-1">No Events Yet</h4>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  This member hasn&apos;t participated in any organization events.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}