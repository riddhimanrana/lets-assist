"use client";
import { PROJECT_CLIENT_SELECT } from "@/lib/projects/client-projection";
import { safeConsole } from "@/lib/safe-console";

import React, { useEffect, useState, useMemo } from "react";
import {
  AlertCircle,
  CalendarClock,
  Printer,
  RefreshCw,
  Search,
  UserRoundCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Project } from "@/types";
import { format, addHours } from "date-fns";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatStrip } from "@/components/layout/SettingsSection";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  checkInParticipant,
  checkOutParticipant,
} from "@/app/projects/[id]/actions";
import { ProjectToolBreadcrumb } from "../ProjectToolBreadcrumb";
import { formatSessionName, type Attendance } from "./attendance-format";
import { printAttendance as printAttendanceRecords } from "./attendance-print";
import {
  AttendanceTable,
  type AttendanceSort as Sort,
  type AttendanceSortField as SortField,
} from "./AttendanceTable";

interface Props {
  projectId: string;
  initialAvailability: {
    isActive: boolean;
    earliestTime?: string;
    project?: Project;
  };
}

export function AttendanceClient({
  projectId,
  initialAvailability,
}: Props): React.JSX.Element {
  const router = useRouter();
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [project, setProject] = useState<Project | null>(
    initialAvailability.project || null,
  );
  const [sessionFilter, setSessionFilter] = useState<string>("all");
  const [sort, setSort] = useState<Sort>({
    field: "check_in_time",
    direction: "desc",
  });
  const [isAttendanceActive] = useState<boolean>(initialAvailability.isActive);
  const [earliestSessionTime] = useState<Date | null>(
    initialAvailability.earliestTime
      ? new Date(initialAvailability.earliestTime)
      : null,
  );
  const [timeUntilOpen, setTimeUntilOpen] = useState<string>("");

  const toggleSort = (field: SortField) => {
    setSort((current) => ({
      field,
      direction:
        current.field === field && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  // Group attendance by session
  const attendanceBySession = useMemo(() => {
    return attendance.reduce(
      (acc, record) => {
        if (!acc[record.schedule_id]) {
          acc[record.schedule_id] = [];
        }
        acc[record.schedule_id].push(record);
        return acc;
      },
      {} as Record<string, Attendance[]>,
    );
  }, [attendance]);

  // Filter and sort attendance based on search term, session filter, and sort state
  const filteredAttendanceBySession = useMemo(() => {
    // First filter by session if needed
    let sessionData: Record<string, Attendance[]> = {};

    if (sessionFilter === "all") {
      sessionData = { ...attendanceBySession };
    } else {
      sessionData = {
        [sessionFilter]: attendanceBySession[sessionFilter] || [],
      };
    }

    // Then filter by search term
    let filtered: Record<string, Attendance[]> = {};

    if (!searchTerm) {
      filtered = { ...sessionData };
    } else {
      const searchLower = searchTerm.toLowerCase();
      Object.entries(sessionData).forEach(([session, sessionAttendance]) => {
        const matchingAttendance = sessionAttendance.filter((record) => {
          const nameMatch = record.user_id
            ? record.profile?.full_name?.toLowerCase().includes(searchLower) ||
              false
            : record.anonymous_signup?.name
                ?.toLowerCase()
                .includes(searchLower) || false;
          const emailMatch = record.user_id
            ? record.profile?.email?.toLowerCase().includes(searchLower) ||
              false
            : record.anonymous_signup?.email
                ?.toLowerCase()
                .includes(searchLower) || false;
          return nameMatch || emailMatch;
        });
        if (matchingAttendance.length > 0) {
          filtered[session] = matchingAttendance;
        }
      });
    }

    // Finally, sort each session's attendance records
    Object.keys(filtered).forEach((session) => {
      filtered[session].sort((a, b) => {
        const direction = sort.direction === "asc" ? 1 : -1;

        if (sort.field === "check_in_time") {
          const timeA = a.check_in_time || "";
          const timeB = b.check_in_time || "";
          return timeA.localeCompare(timeB) * direction;
        }

        if (sort.field === "name") {
          const nameA =
            (a.user_id ? a.profile?.full_name : a.anonymous_signup?.name) || "";
          const nameB =
            (b.user_id ? b.profile?.full_name : b.anonymous_signup?.name) || "";
          return nameA.localeCompare(nameB) * direction;
        }

        return 0;
      });
    });

    return filtered;
  }, [attendanceBySession, searchTerm, sessionFilter, sort]);

  // Get all available sessions for the filter dropdown
  const availableSessions = useMemo(() => {
    return Object.keys(attendanceBySession);
  }, [attendanceBySession]);

  useEffect(() => {
    loadProject();
  }, [projectId]);

  useEffect(() => {
    if (earliestSessionTime && !isAttendanceActive) {
      const now = new Date();
      const openTime = addHours(earliestSessionTime, -2);
      const diffMs = openTime.getTime() - now.getTime();

      if (diffMs > 0) {
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor(
          (diffMs % (1000 * 60 * 60)) / (1000 * 60),
        );

        // Past two days out, hours stop being readable; count days instead.
        const diffDays = Math.floor(diffHours / 24);
        setTimeUntilOpen(
          diffDays >= 2
            ? `${diffDays} days`
            : `${diffHours} hour${diffHours !== 1 ? "s" : ""} and ${diffMinutes} minute${diffMinutes !== 1 ? "s" : ""}`,
        );
      }
    }
  }, [earliestSessionTime, isAttendanceActive]);

  useEffect(() => {
    if (project && isAttendanceActive) {
      loadAttendance();
    }
  }, [project, isAttendanceActive]);

  const loadProject = async () => {
    const supabase = createClient();
    const { data: project, error } = await supabase
      .from("projects")
      .select(PROJECT_CLIENT_SELECT)
      .eq("id", projectId)
      .single();

    if (error) {
      safeConsole.error("Error loading project:", error);
      return;
    }

    setProject(project as Project);
  };

  const loadAttendance = async () => {
    setRefreshing(true);
    const supabase = createClient();

    const { data, error } = await supabase
      .from("project_signups")
      .select(
        `
      id,
      check_in_time,
  check_out_time,
      schedule_id,
      user_id,
      anonymous_id,
      profile:profiles!left (
        full_name,
        username,
        email,
        phone
      ),
      anonymous_signup:anonymous_signups!project_signups_anonymous_id_fkey (
        id,
        name,
        email,
        phone_number
      )
      `,
      )
      .eq("project_id", projectId)
      .order("check_in_time", { ascending: false });

    if (error) {
      safeConsole.error("Error loading attendance:", error);
      toast.error("Failed to load attendance records");
    } else {
      setAttendance(data as unknown as Attendance[]);
      if (refreshing) {
        toast.success("Attendance records refreshed successfully");
      }
    }

    setLoading(false);
    setRefreshing(false);
  };

  const handleManualCheckIn = async (signupId: string) => {
    try {
      const result = await checkInParticipant(signupId);
      if (result.success) {
        toast.success("User checked in successfully");
        loadAttendance(); // Refresh the list
      } else {
        toast.error(result.error || "Failed to check in user");
      }
    } catch {
      toast.error("Failed to check in user");
    }
  };

  const handleManualCheckOut = async (signupId: string) => {
    try {
      const result = await checkOutParticipant(signupId);
      if (result.success) {
        toast.success("User checked out successfully");
        loadAttendance();
      } else {
        toast.error(result.error || "Failed to check out user");
      }
    } catch {
      toast.error("Failed to check out user");
    }
  };

  const printAttendance = () =>
    printAttendanceRecords(project, filteredAttendanceBySession);

  const method = project?.verification_method;
  const manualDisabled = method === "auto" || method === "signup-only";
  const sessionEntries = Object.entries(filteredAttendanceBySession);
  const checkedIn = attendance.filter((record) => record.check_in_time).length;
  const checkedOut = attendance.filter(
    (record) => record.check_out_time,
  ).length;
  const breadcrumb = (
    <ProjectToolBreadcrumb
      projectId={projectId}
      projectTitle={project?.title}
      current="Attendance"
    />
  );

  if (!isAttendanceActive) {
    return (
      <div className="container mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6">
        <PageHeader
          breadcrumb={breadcrumb}
          title="Attendance records"
          description="Attendance management will be available soon"
        />
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarClock aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Attendance management not yet available</EmptyTitle>
            <EmptyDescription>
              Attendance records will be available 2 hours before the event
              starts.
              {earliestSessionTime && timeUntilOpen && (
                <>
                  {" "}
                  Attendance will open in {timeUntilOpen}. First session starts
                  at: {format(earliestSessionTime, "MMMM d, yyyy 'at' h:mm a")}
                </>
              )}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => router.back()}>
              Return to project
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="container mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6">
      <PageHeader
        breadcrumb={breadcrumb}
        title="Attendance records"
        description={
          method === "manual"
            ? "Check in volunteers and manage attendee records"
            : method === "auto"
              ? "View volunteer attendance (check-ins are automatic)"
              : method === "signup-only"
                ? "View volunteer attendance records"
                : "View and track check-ins for your project"
        }
        actions={
          <>
            <Button
              variant="outline"
              onClick={loadAttendance}
              disabled={refreshing}
              aria-label="Refresh"
            >
              <RefreshCw
                data-icon="inline-start"
                className={refreshing ? "animate-spin" : undefined}
                aria-hidden="true"
              />
              Refresh
            </Button>
            <Button
              onClick={printAttendance}
              disabled={sessionEntries.length === 0}
              aria-label="Print Attendance"
            >
              <Printer data-icon="inline-start" aria-hidden="true" />
              Print attendance
            </Button>
          </>
        }
      />

      <StatStrip
        items={[
          { label: "Signed up", value: loading ? "–" : attendance.length },
          { label: "Checked in", value: loading ? "–" : checkedIn },
          { label: "Checked out", value: loading ? "–" : checkedOut },
          {
            label: "Not checked in",
            value: loading ? "–" : attendance.length - checkedIn,
          },
        ]}
      />

      {(method === "auto" || method === "signup-only") && (
        <Alert>
          <AlertCircle aria-hidden="true" />
          <AlertTitle>
            {method === "auto"
              ? "Automatic check-in enabled"
              : "Sign-up only project"}
          </AlertTitle>
          <AlertDescription>
            {method === "auto"
              ? "Volunteers will be automatically checked in at their scheduled start time. Manual check-in is not required."
              : "This project is configured for sign-up tracking only. No check-in functionality is available."}
          </AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4" aria-label="Attendance">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <InputGroup className="sm:max-w-xs">
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Search by name or email"
            />
          </InputGroup>
          <Select
            value={sessionFilter}
            onValueChange={(val) => setSessionFilter(val || "all")}
          >
            <SelectTrigger
              className="w-full sm:w-auto sm:min-w-60"
              aria-label="Filter by session"
            >
              <SelectValue placeholder="Filter by session">
                {sessionFilter === "all"
                  ? "All sessions"
                  : project
                    ? formatSessionName(project, sessionFilter)
                    : "Filter by session"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-w-100">
              <SelectItem value="all">All sessions</SelectItem>
              {availableSessions.map((session) => (
                <SelectItem key={session} value={session}>
                  {formatSessionName(project as Project, session)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="grid gap-2" aria-busy="true">
            <span className="sr-only">Loading attendance records...</span>
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : sessionEntries.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UserRoundCheck aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No attendance records found</EmptyTitle>
              <EmptyDescription>
                No one has checked in yet or no records match your filters.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          sessionEntries.map(([session, sessionAttendance]) => (
            <div key={session} className="grid gap-2">
              <h2 className="text-sm font-medium">
                {project && formatSessionName(project, session)}{" "}
                <span className="text-muted-foreground font-normal tabular-nums">
                  ({sessionAttendance.length})
                </span>
              </h2>
              <AttendanceTable
                records={sessionAttendance}
                sort={sort}
                onSort={toggleSort}
                manualDisabled={manualDisabled}
                onCheckIn={handleManualCheckIn}
                onCheckOut={handleManualCheckOut}
              />
            </div>
          ))
        )}
      </section>
    </div>
  );
}
