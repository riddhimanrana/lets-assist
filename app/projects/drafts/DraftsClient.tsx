"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, isValid, parse } from "date-fns";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn, stripHtml } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Calendar,
  MapPin,
  Building2,
  Edit,
  Trash2,
  MoreVertical,
  FileText,
  Plus,
  Clock,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import type { ProjectSchedule, EventType } from "@/types";
import { deleteDraft, publishDraft } from "../create/actions";
import Image from "next/image";

interface Draft {
  id: string;
  title: string;
  description: string;
  location: string;
  event_type: EventType;
  schedule: ProjectSchedule | null;
  cover_image_url: string | null;
  created_at: string;
  workflow_status: string;
  organization: {
    id: string;
    name: string;
    logo_url: string | null;
  } | null;
}

/** One date format for every date on a draft row: "Oct 7, 2026". */
const DRAFT_DATE_FORMAT = "MMM d, yyyy";

/** A yyyy-MM-dd schedule day, read as a local day so it does not shift. */
function formatScheduleDay(day: string) {
  const date = parse(day, "yyyy-MM-dd", new Date());
  return isValid(date)
    ? format(date, DRAFT_DATE_FORMAT)
    : "Schedule incomplete";
}

/** The rich-text description as one run of plain text. */
function descriptionPreview(description: string) {
  return stripHtml(
    description.replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, "$& "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

interface DraftsClientProps {
  drafts: Draft[];
}

export default function DraftsClient({
  drafts: initialDrafts,
}: DraftsClientProps) {
  const router = useRouter();
  const [drafts, setDrafts] = useState(initialDrafts);
  const [isPublishing, setIsPublishing] = useState<string | null>(null);
  const [draftToDelete, setDraftToDelete] = useState<string | null>(null);

  const handleDelete = async (draftId: string) => {
    try {
      const result = await deleteDraft(draftId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Draft deleted");
        setDrafts(drafts.filter((d) => d.id !== draftId));
      }
    } catch {
      toast.error("Failed to delete draft");
    }
  };

  const handlePublish = async (draftId: string) => {
    setIsPublishing(draftId);
    try {
      const result = await publishDraft(draftId);
      if ("error" in result && result.error) {
        toast.error(result.error);
      } else if ("success" in result && result.success && result.id) {
        toast.success("Project published successfully!");
        router.push(`/projects/${result.id}`);
      }
    } catch {
      toast.error("Failed to publish project");
    } finally {
      setIsPublishing(null);
    }
  };

  const getSchedulePreview = (draft: Draft) => {
    const schedule = draft.schedule;
    if (!schedule) return "No schedule set";

    if (draft.event_type === "oneTime" && schedule.oneTime?.date) {
      return formatScheduleDay(schedule.oneTime.date);
    }
    if (draft.event_type === "multiDay") {
      const days = schedule.multiDay?.length ?? 0;
      if (days === 0) return "Schedule incomplete";
      return `${days} ${days === 1 ? "day" : "days"}`;
    }
    if (
      draft.event_type === "sameDayMultiArea" &&
      schedule.sameDayMultiArea?.date
    ) {
      return formatScheduleDay(schedule.sameDayMultiArea.date);
    }
    return "Schedule incomplete";
  };

  const header = (
    <PageHeader
      title="My drafts"
      description={
        drafts.length === 0
          ? "Projects you've started but haven't published yet"
          : `${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"} saved`
      }
      actions={
        <Link href="/projects/create" className={cn(buttonVariants())}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          New project
        </Link>
      }
    />
  );

  if (drafts.length === 0) {
    return (
      <div className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-8 sm:px-6">
        {header}
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No drafts yet</EmptyTitle>
            <EmptyDescription>
              Save a project as a draft while you create it, and it will wait
              for you here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-8 sm:px-6">
      {header}

      <div className="grid gap-4">
        {drafts.map((draft) => {
          const description = descriptionPreview(draft.description);

          return (
            <Card key={draft.id} className="gap-3 px-4">
              <div className="flex items-start gap-4">
                {draft.cover_image_url ? (
                  <div className="bg-muted relative hidden h-24 w-36 shrink-0 overflow-hidden rounded-lg sm:block">
                    <Image
                      src={draft.cover_image_url}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="144px"
                    />
                  </div>
                ) : null}

                <div className="grid min-w-0 flex-1 gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-semibold">
                      {draft.title || "Untitled draft"}
                    </h2>
                    <Badge variant="neutral">Draft</Badge>
                  </div>

                  {draft.organization?.name ? (
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                      {draft.organization.logo_url ? (
                        <Avatar className="size-4">
                          <AvatarImage src={draft.organization.logo_url} />
                          <AvatarFallback>
                            <Building2 className="size-3" aria-hidden="true" />
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        <Building2 className="size-4" aria-hidden="true" />
                      )}
                      {draft.organization.name}
                    </div>
                  ) : null}

                  <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <div className="flex items-center gap-1">
                      <Calendar className="size-4" aria-hidden="true" />
                      {getSchedulePreview(draft)}
                    </div>
                    {draft.location && (
                      <div className="flex min-w-0 items-center gap-1">
                        <MapPin
                          className="size-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="max-w-50 truncate">
                          {draft.location}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <Clock className="size-4" aria-hidden="true" />
                      Saved{" "}
                      {format(new Date(draft.created_at), DRAFT_DATE_FORMAT)}
                    </div>
                  </div>

                  <p className="text-muted-foreground line-clamp-2 text-sm">
                    {description || "No description yet"}
                  </p>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`Actions for ${draft.title || "untitled draft"}`}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "icon" }),
                      "shrink-0",
                    )}
                  >
                    <MoreVertical aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>
                      <Link
                        href={`/projects/${draft.id}/edit`}
                        className="flex w-full items-center gap-2"
                      >
                        <Edit aria-hidden="true" />
                        Continue editing
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handlePublish(draft.id)}
                      disabled={isPublishing === draft.id}
                    >
                      <Send aria-hidden="true" />
                      {isPublishing === draft.id
                        ? "Publishing..."
                        : "Publish now"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setDraftToDelete(draft.id)}
                    >
                      <Trash2 aria-hidden="true" />
                      Delete draft
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Quick actions on phones, where the menu is easy to miss. */}
              <div className="flex gap-2 sm:hidden">
                <Link
                  href={`/projects/${draft.id}/edit`}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "flex-1",
                  )}
                >
                  <Edit data-icon="inline-start" aria-hidden="true" />
                  Edit
                </Link>
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => handlePublish(draft.id)}
                  disabled={isPublishing === draft.id}
                >
                  <Send data-icon="inline-start" aria-hidden="true" />
                  Publish
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <AlertDialog
        open={!!draftToDelete}
        onOpenChange={(open) => !open && setDraftToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the draft. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (draftToDelete) {
                  handleDelete(draftToDelete);
                  setDraftToDelete(null);
                }
              }}
              variant="destructive"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
