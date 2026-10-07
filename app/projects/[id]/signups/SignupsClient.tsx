"use client";
import { PROJECT_CLIENT_SELECT } from "@/lib/projects/client-projection";
import { safeConsole } from "@/lib/safe-console";

import React, { useEffect, useState, useMemo } from "react";
import { Pause, RefreshCw, Search, UserRoundSearch } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Project } from "@/types";
import {
  getWaiverDownloadUrl,
  rejectSignup,
  togglePauseSignups,
  unrejectSignup,
} from "../actions";
import { getOrganizerSignupsWithWaiverStatus } from "./actions";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  WaiverPreviewDialog,
  WaiverPreviewSignature,
} from "@/components/projects/WaiverPreviewDialog";
import { SignupResponsesDialog } from "@/components/projects/SignupResponsesDialog";
import { ProjectToolBreadcrumb } from "../ProjectToolBreadcrumb";
import {
  formatScheduleSlot,
  type OrganizerSignup as Signup,
} from "./signups-format";
import { AttendanceTools } from "@/components/projects/AttendanceTools";
import { SignupsTable } from "./SignupsTable";

interface Props {
  projectId: string;
}

type SortField = "status"; // Add other fields like 'name', 'type', 'contact' if needed
type SortDirection = "asc" | "desc";

interface Sort {
  field: SortField;
  direction: SortDirection;
}

export function SignupsClient({ projectId }: Props): React.JSX.Element {
  const [signups, setSignups] = useState<Signup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingSignups, setProcessingSignups] = useState<
    Record<string, boolean>
  >({});
  const [searchTerm, setSearchTerm] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [sort, setSort] = useState<Sort>({ field: "status", direction: "asc" });
  const [isPausingSignups, setIsPausingSignups] = useState(false);
  const [pausedSignups, setPausedSignups] = useState(false);
  const [unrejectingSignups, setUnrejectingSignups] = useState<
    Record<string, boolean>
  >({});
  const [waiverDownloads, setWaiverDownloads] = useState<
    Record<string, boolean>
  >({});

  // Waiver preview state
  const [previewSignature, setPreviewSignature] =
    useState<WaiverPreviewSignature | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Response dialog state
  const [selectedSignupForResponse, setSelectedSignupForResponse] =
    useState<Signup | null>(null);
  const [isResponseDialogOpen, setIsResponseDialogOpen] = useState(false);

  const toggleSort = (field: SortField) => {
    setSort((current) => ({
      field,
      direction:
        current.field === field && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  // Group signups by schedule slot
  const signupsBySlot = useMemo(() => {
    return signups.reduce(
      (acc, signup) => {
        if (!acc[signup.schedule_id]) {
          acc[signup.schedule_id] = [];
        }
        acc[signup.schedule_id].push(signup);
        return acc;
      },
      {} as Record<string, Signup[]>,
    );
  }, [signups]);

  // Filter and sort signups based on search term and sort state - Updated for new structure
  const filteredSignupsBySlot = useMemo(() => {
    let filtered: Record<string, Signup[]> = {};

    // Apply filtering first
    if (!searchTerm) {
      filtered = { ...signupsBySlot }; // Clone to avoid modifying original
    } else {
      const searchLower = searchTerm.toLowerCase();
      Object.entries(signupsBySlot).forEach(([slot, slotSignups]) => {
        const matchingSignups = slotSignups.filter((signup) => {
          const nameMatch = signup.user_id
            ? signup.profile?.full_name.toLowerCase().includes(searchLower)
            : signup.anonymous_signup?.name
                ?.toLowerCase()
                .includes(searchLower); // Check anonymous name
          const emailMatch = signup.user_id
            ? signup.profile?.email.toLowerCase().includes(searchLower)
            : signup.anonymous_signup?.email
                ?.toLowerCase()
                .includes(searchLower); // Check anonymous email
          // Add phone search if needed
          return nameMatch || emailMatch;
        });
        if (matchingSignups.length > 0) {
          filtered[slot] = matchingSignups;
        }
      });
    }

    // Apply sorting to each slot's signups
    Object.keys(filtered).forEach((slot) => {
      filtered[slot].sort((a, b) => {
        const direction = sort.direction === "asc" ? 1 : -1;

        if (sort.field === "status") {
          // Sort logic: 'pending' < 'approved' < 'rejected'
          const statusOrder = { pending: 0, approved: 1, rejected: 2 };
          const statusA = statusOrder[a.status];
          const statusB = statusOrder[b.status];
          return (statusA - statusB) * direction;
        }

        // Add sorting for other fields here if needed
        // Example for name:
        // if (sort.field === 'name') {
        //   const nameA = (a.profile?.full_name || a.anonymous_signup?.name || '').toLowerCase();
        //   const nameB = (b.profile?.full_name || a.anonymous_signup?.name || '').toLowerCase();
        //   return nameA.localeCompare(nameB) * direction;
        // }

        return 0; // Default: no change in order
      });
    });

    return filtered;
  }, [signupsBySlot, searchTerm, sort]);

  useEffect(() => {
    loadProject();
    loadSignups();
  }, [projectId]);

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
    setPausedSignups(project.pause_signups || false);
  };

  // Update Supabase query to join anonymous_signups
  const loadSignups = async () => {
    setRefreshing(true);
    try {
      const result = await getOrganizerSignupsWithWaiverStatus(projectId);

      if (result && "error" in result && result.error) {
        toast.error(result.error);
      } else {
        setSignups((result as { signups: unknown[] }).signups as Signup[]);
        if (refreshing) {
          toast.success("Signups refreshed successfully");
        }
      }
    } catch (error) {
      safeConsole.error("Error loading signups:", error);
      toast.error("Failed to load signups");
    }

    setLoading(false);
    setRefreshing(false);
  };

  // The rejection and the volunteer's notification commit together in one
  // server transaction, so the toast can state exactly what happened instead of
  // reporting success for a half-completed change.
  const handleReject = async (signupId: string) => {
    try {
      setProcessingSignups((prev) => ({ ...prev, [signupId]: true }));

      const result = await rejectSignup(signupId);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      await loadSignups();

      if (result.outcome === "replayed") {
        toast.info("This signup was already rejected.");
        return;
      }

      if (result.notificationReason === "anonymous_signup") {
        toast.success(
          "Signup rejected. Anonymous volunteers receive no in-app notification.",
        );
        return;
      }

      if (result.notificationReason === "notification_preference_disabled") {
        toast.success(
          "Signup rejected. This volunteer has turned off project update notifications.",
        );
        return;
      }

      toast.success("Signup rejected and the volunteer was notified.");
    } catch (error) {
      safeConsole.error("Error rejecting signup:", error);
      toast.error("Failed to reject signup");
    } finally {
      setProcessingSignups((prev) => ({ ...prev, [signupId]: false }));
    }
  };

  const handleOpenWaiverPreview = async (signup: Signup) => {
    const waiverSignature = Array.isArray(signup.waiver_signature)
      ? signup.waiver_signature[0]
      : signup.waiver_signature;

    if (waiverSignature) {
      try {
        // Resolve signatureId from server to avoid stale/incorrect embedded IDs.
        const result = await getWaiverDownloadUrl(signup.id);

        if (result?.error) {
          toast.error(result.error);
          return;
        }

        const resolvedId = result?.signatureId || waiverSignature.id;
        if (!resolvedId) {
          toast.error("Signature not found");
          return;
        }

        setPreviewSignature({
          ...waiverSignature,
          id: resolvedId,
        });
        setPreviewOpen(true);
      } catch (error) {
        safeConsole.error("Error resolving waiver signature:", error);
        toast.error("Failed to open waiver preview");
      }
    }
  };

  const handleViewResponses = (signup: Signup) => {
    setSelectedSignupForResponse(signup);
    setIsResponseDialogOpen(true);
  };

  const handleDownloadWaiverForSignup = async (signupId: string) => {
    try {
      const result = await getWaiverDownloadUrl(signupId);

      if (result?.error) {
        toast.error(result.error);
        return;
      }

      if (result?.signatureId) {
        await handleDownloadWaiver(result.signatureId);
        return;
      }

      if (result?.url) {
        // Legacy/offline upload signed URL.
        window.open(result.url, "_blank", "noopener,noreferrer");
        return;
      }

      toast.error("Signature not found");
    } catch (error) {
      safeConsole.error("Error downloading waiver:", error);
      toast.error("Failed to download waiver");
    }
  };

  const handleDownloadWaiver = async (signatureId: string) => {
    try {
      setWaiverDownloads((prev) => ({ ...prev, [signatureId]: true }));

      const response = await fetch(`/api/waivers/${signatureId}/download`);

      if (!response.ok) {
        throw new Error("Download failed");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `waiver-${signatureId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success("Waiver downloaded successfully");
    } catch (error) {
      safeConsole.error("Error downloading waiver:", error);
      toast.error("Failed to download waiver");
    } finally {
      setWaiverDownloads((prev) => ({ ...prev, [signatureId]: false }));
    }
  };

  const handleUnreject = async (signupId: string) => {
    try {
      setUnrejectingSignups((prev) => ({ ...prev, [signupId]: true }));

      const result = await unrejectSignup(signupId);

      if (result.error) {
        throw new Error(result.error);
      }

      // Refresh the signups list
      await loadSignups();
      toast.success("Signup approved successfully");
    } catch (error) {
      safeConsole.error("Error unrejecting signup:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to unreject signup",
      );
    } finally {
      setUnrejectingSignups((prev) => ({ ...prev, [signupId]: false }));
    }
  };

  const togglePause = async () => {
    if (!project) return;

    try {
      setIsPausingSignups(true);
      const newPauseState = !pausedSignups;

      const result = await togglePauseSignups(projectId, newPauseState);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      setPausedSignups(newPauseState);
      toast.success(
        newPauseState
          ? "Signups have been paused"
          : "Signups have been resumed",
      );
    } catch (error) {
      safeConsole.error("Error toggling pause state:", error);
      toast.error("Failed to update signup status");
    } finally {
      setIsPausingSignups(false);
    }
  };

  const slotEntries = Object.entries(filteredSignupsBySlot);
  const countByStatus = (status: Signup["status"]) =>
    signups.filter((signup) => signup.status === status).length;

  return (
    <div className="container mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6">
      <WaiverPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        signature={previewSignature}
        onDownload={handleDownloadWaiver}
        isDownloading={
          previewSignature ? waiverDownloads[previewSignature.id] : false
        }
      />

      <SignupResponsesDialog
        isOpen={isResponseDialogOpen}
        onClose={() => setIsResponseDialogOpen(false)}
        responseData={selectedSignupForResponse?.response_data || null}
        formSchema={project?.signup_form_schema || null}
        participantName={
          selectedSignupForResponse?.user_id
            ? selectedSignupForResponse.profile?.full_name || "Volunteer"
            : selectedSignupForResponse?.anonymous_signup?.name || "Anonymous"
        }
      />

      <PageHeader
        breadcrumb={
          <ProjectToolBreadcrumb
            projectId={projectId}
            projectTitle={project?.title}
            current="Signups"
          />
        }
        title="Manage volunteer signups"
        description="Review and manage volunteer signups."
        actions={<AttendanceTools projectId={projectId} />}
      />

      <StatStrip
        items={[
          { label: "Signups", value: loading ? "–" : signups.length },
          {
            label: "Approved",
            value: loading ? "–" : countByStatus("approved"),
          },
          { label: "Pending", value: loading ? "–" : countByStatus("pending") },
          {
            label: "Rejected",
            value: loading ? "–" : countByStatus("rejected"),
          },
        ]}
      />

      <section className="grid gap-4" aria-label="Signups">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <InputGroup className="sm:max-w-xs">
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search by name..."
              aria-label="Search signups by name or email"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </InputGroup>
          <div className="flex items-center justify-between gap-3 sm:ml-auto">
            <div className="flex min-h-9 items-center gap-2">
              <Switch
                id="pause-signups"
                checked={pausedSignups}
                onCheckedChange={togglePause}
                disabled={isPausingSignups}
              />
              <Label htmlFor="pause-signups">
                {pausedSignups ? "Signups paused" : "Accepting signups"}
                {isPausingSignups && <Spinner />}
              </Label>
            </div>
            <Button
              variant="outline"
              onClick={loadSignups}
              disabled={refreshing}
            >
              <RefreshCw
                data-icon="inline-start"
                className={refreshing ? "animate-spin" : undefined}
                aria-hidden="true"
              />
              Refresh
            </Button>
          </div>
        </div>

        {project?.pause_signups && (
          <Alert variant="warning">
            <Pause aria-hidden="true" />
            <AlertTitle>Signups are currently paused</AlertTitle>
            <AlertDescription>
              New volunteer signups are disabled. Toggle the switch above to
              resume accepting volunteers.
            </AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="grid gap-2" aria-busy="true">
            <span className="sr-only">Loading signups...</span>
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : slotEntries.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UserRoundSearch aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No signups found</EmptyTitle>
              <EmptyDescription>
                Try adjusting your search or check back later.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          slotEntries.map(([slot, slotSignups]) => (
            <div key={slot} className="grid gap-2">
              <h2 className="text-sm font-medium">
                {project && formatScheduleSlot(project, slot)}{" "}
                <span className="text-muted-foreground font-normal tabular-nums">
                  ({slotSignups.length})
                </span>
              </h2>
              <SignupsTable
                signups={slotSignups}
                showComments={Boolean(project?.enable_volunteer_comments)}
                showWaiver={Boolean(project?.waiver_required)}
                statusSort={sort.direction}
                onToggleStatusSort={() => toggleSort("status")}
                processing={processingSignups}
                unrejecting={unrejectingSignups}
                waiverDownloads={waiverDownloads}
                onReject={handleReject}
                onUnreject={handleUnreject}
                onViewResponses={handleViewResponses}
                onViewWaiver={handleOpenWaiverPreview}
                onDownloadWaiver={handleDownloadWaiverForSignup}
              />
            </div>
          ))
        )}
      </section>
    </div>
  );
}
