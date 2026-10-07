"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Clock, ScanText, Search, UserRoundCheck } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { StatStrip } from "@/components/layout/SettingsSection";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { Spinner } from "@/components/ui/spinner";
import { Project, ProjectSignup } from "@/types";
import { ProjectToolBreadcrumb } from "../ProjectToolBreadcrumb";
import {
  HoursCertificatesDialog,
  HoursConfirmPublishDialog,
  HoursPublishSuccessDialog,
} from "./HoursDialogs";
import { HoursSessionCard } from "./HoursSessionCard";
import { useHoursEdits } from "./useHoursEdits";
import { useHoursPublishing } from "./useHoursPublishing";
import { useHoursSessions, type HoursSession } from "./useHoursSessions";

interface Props {
  project: Project;
  initialSignups: ProjectSignup[];
}

const SESSION_GROUPS: Array<{ status: HoursSession["status"]; label: string }> =
  [
    { status: "editing", label: "Editing window open" },
    { status: "in-progress", label: "In progress" },
    { status: "upcoming", label: "Upcoming" },
    { status: "completed", label: "Completed" },
  ];

export function HoursClient({
  project,
  initialSignups,
}: Props): React.JSX.Element {
  const [signups] = useState<ProjectSignup[]>(initialSignups);
  const [searchTerm, setSearchTerm] = useState("");
  const [sessionFilter, setSessionFilter] = useState<string>("all");

  const sessions = useHoursSessions({
    project,
    signups,
    searchTerm,
    sessionFilter,
  });
  const {
    filteredSignupsBySession,
    getAllProjectSessions,
    isSessionPublished,
    activeUnpublishedSessions,
  } = sessions;
  const edits = useHoursEdits({
    initialSignups,
    signupsBySession: sessions.signupsBySession,
    getAllProjectSessions,
  });
  const publishing = useHoursPublishing({
    project,
    editedTimes: edits.editedTimes,
    sessions,
  });

  const sessionLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    map.set("all", "All sessions");

    getAllProjectSessions.forEach((session) => {
      map.set(session.id, session.name);
      session.alternativeIds?.forEach((altId) => {
        map.set(altId, session.name);
      });
    });

    return map;
  }, [getAllProjectSessions]);

  const visibleSessions =
    sessionFilter === "all"
      ? getAllProjectSessions
      : getAllProjectSessions.filter((s) => s.id === sessionFilter);
  const publishedCount = getAllProjectSessions.filter((session) =>
    isSessionPublished(session.id),
  ).length;

  // A session's signups are keyed by its id or by one of its older id formats.
  const signupsForSession = (session: HoursSession): ProjectSignup[] => {
    if (filteredSignupsBySession[session.id]) {
      return filteredSignupsBySession[session.id];
    }
    for (const altId of session.alternativeIds) {
      if (filteredSignupsBySession[altId]) {
        return filteredSignupsBySession[altId];
      }
    }
    return [];
  };

  return (
    <div className="container mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6">
      <HoursPublishSuccessDialog publishing={publishing} />
      <HoursConfirmPublishDialog publishing={publishing} />
      <HoursCertificatesDialog publishing={publishing} />

      <PageHeader
        breadcrumb={
          <ProjectToolBreadcrumb
            projectId={project.id}
            projectTitle={project.title}
            current="Hours"
          />
        }
        title="Manage volunteer hours"
        description="Review and edit volunteer check-in/out times. If no changes are made, the system will automatically publish hours after 48 hours."
        actions={
          <Button
            variant="outline"
            render={<Link href={`/projects/${project.id}/paper-signups`} />}
          >
            <ScanText data-icon="inline-start" aria-hidden="true" />
            Add from paper sheet
          </Button>
        }
      />

      <StatStrip
        items={[
          { label: "Sessions", value: getAllProjectSessions.length },
          {
            label: "Editing windows open",
            value: activeUnpublishedSessions.length,
          },
          { label: "Published", value: publishedCount },
          { label: "Attendance records", value: signups.length },
        ]}
      />

      {activeUnpublishedSessions.length > 0 && (
        <Alert variant="warning">
          <Clock aria-hidden="true" />
          <AlertTitle>Editing windows open</AlertTitle>
          <AlertDescription>
            You have active sessions that can still be edited.
            <div className="mt-3 flex flex-wrap gap-2">
              {activeUnpublishedSessions.map((session) => (
                <Button
                  key={session.id}
                  variant="outline"
                  className="h-auto min-h-9 max-w-full py-1.5 whitespace-normal"
                  onClick={() => setSessionFilter(session.id)}
                >
                  {publishing.publishingSessions[session.id] && (
                    <Spinner data-icon="inline-start" />
                  )}
                  <span className="text-left">
                    {session.name}
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      · {session.hoursRemaining}h left to edit
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4" aria-label="Sessions">
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
              <SelectValue>
                {(value) => {
                  if (!value) {
                    return "Filter by session";
                  }

                  return sessionLabelMap.get(String(value)) ?? String(value);
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-w-100">
              <SelectItem value="all">All sessions</SelectItem>
              {SESSION_GROUPS.map((group) => {
                const groupSessions = getAllProjectSessions.filter(
                  (s) => s.status === group.status,
                );
                if (groupSessions.length === 0) return null;
                return (
                  <SelectGroup key={group.status}>
                    <SelectLabel>{group.label}</SelectLabel>
                    {groupSessions.map((session) => (
                      <SelectItem
                        key={`${group.status}-${session.id}`}
                        value={session.id}
                      >
                        {session.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {getAllProjectSessions.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UserRoundCheck aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No sessions found</EmptyTitle>
              <EmptyDescription>
                This project doesn&apos;t have any scheduled sessions.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          visibleSessions.map((session) => (
            <HoursSessionCard
              key={session.id}
              session={session}
              sessionSignups={signupsForSession(session)}
              isPublished={isSessionPublished(session.id)}
              edits={edits}
              publishing={publishing}
            />
          ))
        )}
      </section>
    </div>
  );
}
