"use client";

import { useState } from "react";
import { Search, UserRoundCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatStrip } from "@/components/layout/SettingsSection";
import { AttendanceTools } from "@/components/projects/AttendanceTools";
import { AttendanceExport } from "@/components/projects/AttendanceExport";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Empty,
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Project } from "@/types";
import { ProjectToolBreadcrumb } from "../ProjectToolBreadcrumb";
import { HoursConfirmPublishDialog, HoursEditDialog } from "./HoursDialogs";
import { HoursSessionCard } from "./HoursSessionCard";
import type { AttendanceHoursSignup, HoursWindows } from "./useHoursAttendance";
import { useHoursEdits } from "./useHoursEdits";
import { useHoursPublishing } from "./useHoursPublishing";
import { useHoursSessions, type HoursSession } from "./useHoursSessions";

export type { AttendanceHoursSignup } from "./useHoursAttendance";
const SESSION_GROUPS: Array<{ status: HoursSession["status"]; label: string }> =
  [
    { status: "completed", label: "Completed" },
    { status: "in-progress", label: "In progress" },
    { status: "upcoming", label: "Upcoming" },
    { status: "invalid", label: "Schedule needs review" },
  ];

export function HoursClient({
  project,
  initialSignups,
  windows,
}: {
  project: Project;
  initialSignups: AttendanceHoursSignup[];
  windows: HoursWindows;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sessionFilter, setSessionFilter] = useState("all");
  const [notice, setNotice] = useState("");
  const sessions = useHoursSessions({
    project,
    signups: initialSignups,
    windows,
    searchTerm,
  });
  const edits = useHoursEdits({
    projectId: project.id,
    signups: initialSignups,
    setNotice,
  });
  const publishing = useHoursPublishing({
    projectId: project.id,
    sessions,
    setNotice,
  });
  const activeFilter = sessions.some((session) => session.id === sessionFilter)
    ? sessionFilter
    : "all";
  const visibleSessions = sessions.filter(
    (session) => activeFilter === "all" || session.id === activeFilter,
  );
  const disabled =
    publishing.busy !== null ||
    publishing.isRefreshing ||
    edits.isRefreshing ||
    edits.editing !== null;
  const timezone = project.project_timezone || "America/Los_Angeles";
  return (
    <main className="container mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6">
      <HoursConfirmPublishDialog publishing={publishing} />
      <HoursEditDialog edits={edits} project={project} windows={windows} />
      <PageHeader
        breadcrumb={
          <ProjectToolBreadcrumb
            projectId={project.id}
            projectTitle={project.title}
            current="Hours"
          />
        }
        title="Manage volunteer hours"
        description={`Review actual attendance, publish credit, and correct earlier awards. Times use ${timezone}.`}
        actions={<AttendanceTools projectId={project.id} />}
      />
      <StatStrip
        items={[
          { label: "Sessions", value: sessions.length },
          {
            label: "Ready to publish",
            value: sessions
              .filter(
                (session) =>
                  !session.published && session.status === "completed",
              )
              .reduce((count, session) => count + session.readyCount, 0),
            helper: "Reviewed attendance records",
          },
          {
            label: "Published",
            value: sessions.filter((session) => session.published).length,
          },
          { label: "Attendance records", value: initialSignups.length },
        ]}
      />
      {notice && (
        <Alert role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <section className="grid gap-4" aria-label="Sessions">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
          <InputGroup className="sm:max-w-xs">
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              aria-label="Search by name or email"
            />
          </InputGroup>
          <Select
            value={activeFilter}
            onValueChange={(value) => setSessionFilter(value || "all")}
          >
            <SelectTrigger
              className="w-full sm:w-auto sm:min-w-60"
              aria-label="Filter by session"
            >
              <SelectValue>
                {(value) =>
                  value === "all"
                    ? "All sessions"
                    : (sessions.find((session) => session.id === value)?.name ??
                      "Filter by session")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-w-100">
              <SelectItem value="all">All sessions</SelectItem>
              {SESSION_GROUPS.map((group) => {
                const matches = sessions.filter(
                  (session) => session.status === group.status,
                );
                return matches.length ? (
                  <SelectGroup key={group.status}>
                    <SelectLabel>{group.label}</SelectLabel>
                    {matches.map((session) => (
                      <SelectItem key={session.id} value={session.id}>
                        {session.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null;
              })}
            </SelectContent>
          </Select>
          <AttendanceExport
            scope="project"
            scopeId={project.id}
            sessionId={activeFilter}
          />
        </div>
        {sessions.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UserRoundCheck aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No attendance yet</EmptyTitle>
              <EmptyDescription>
                No approved volunteers or recorded attendance yet. Add a walk-in
                or scan a completed sheet to begin.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          visibleSessions.map((session) => (
            <HoursSessionCard
              key={session.id}
              session={session}
              timezone={timezone}
              disabled={disabled}
              edits={edits}
              publishing={publishing}
            />
          ))
        )}
      </section>
    </main>
  );
}
