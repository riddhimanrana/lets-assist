"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  Send
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

interface DraftsClientProps {
  drafts: Draft[];
}

export default function DraftsClient({ drafts: initialDrafts }: DraftsClientProps) {
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
        setDrafts(drafts.filter(d => d.id !== draftId));
      }
    } catch {
      toast.error("Failed to delete draft");
    }
  };

  const handlePublish = async (draftId: string) => {
    setIsPublishing(draftId);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await publishDraft(draftId) as any;
      if (result.error) {
        toast.error(result.error);
      } else if (result.success && result.id) {
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
      return format(new Date(schedule.oneTime.date), "MMMM d, yyyy");
    }
    if (draft.event_type === "multiDay") {
      const days = schedule.multiDay?.length ?? 0;
      return days > 0 ? `${days} day(s)` : "Schedule incomplete";
    }
    if (draft.event_type === "sameDayMultiArea" && schedule.sameDayMultiArea?.date) {
      return format(new Date(schedule.sameDayMultiArea.date), "MMMM d, yyyy");
    }
    return "Schedule incomplete";
  };

  if (drafts.length === 0) {
    return (
      <div className="container max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">My Drafts</h1>
            <p className="text-muted-foreground mt-1">
              Projects you&apos;ve started but haven&apos;t published yet
            </p>
          </div>
          <Link href="/projects/create" className={cn(buttonVariants())}>
            <Plus className="h-4 w-4 mr-2" />
            New Project
          </Link>
        </div>

        <Card className="text-center py-12">
          <CardContent>
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No drafts yet</h3>
            <p className="text-muted-foreground mb-4">
              Start creating a project and save it as a draft to continue later.
            </p>
            <Link href="/projects/create" className={cn(buttonVariants())}>Create Your First Project</Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">My Drafts</h1>
          <p className="text-muted-foreground mt-1">
            {drafts.length} draft{drafts.length !== 1 ? "s" : ""} saved
          </p>
        </div>
        <Link href="/projects/create" className={cn(buttonVariants())}>
          <Plus className="h-4 w-4 mr-2" />
          New Project
        </Link>
      </div>

      <div className="space-y-4">
        {drafts.map((draft) => (
          <Card key={draft.id} className="overflow-hidden">
            <div className="flex flex-col sm:flex-row">
              {/* Cover image or placeholder */}
              <div className="sm:w-48 h-32 sm:h-auto bg-muted shrink-0">
                {draft.cover_image_url ? (
                  <Image
                    src={draft.cover_image_url}
                    alt={draft.title}
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 100vw, 192px"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold text-lg truncate">
                        {draft.title || "Untitled Draft"}
                      </h3>
                      <Badge variant="secondary" className="shrink-0">
                        Draft
                      </Badge>
                    </div>

                    {draft.organization && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                        {draft.organization.logo_url ? (
                          <Avatar className="h-4 w-4">
                            <AvatarImage src={draft.organization.logo_url} />
                            <AvatarFallback>
                              <Building2 className="h-3 w-3" />
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <Building2 className="h-4 w-4" />
                        )}
                        {draft.organization.name}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-4 w-4" />
                        {getSchedulePreview(draft)}
                      </div>
                      {draft.location && (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-4 w-4" />
                          <span className="truncate max-w-[200px]">{draft.location}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        Saved {format(new Date(draft.created_at), "MMM d, yyyy")}
                      </div>
                    </div>

                    <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                      {draft.description || "No description yet"}
                    </p>
                  </div>

                  {/* Actions */}
                  {/* Actions */}
                  <DropdownMenu>
                    <DropdownMenuTrigger className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "shrink-0")}>
                      <MoreVertical className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>
                        <Link href={`/projects/${draft.id}/edit`} className="flex w-full items-center">
                          <Edit className="h-4 w-4 mr-2" />
                          Continue Editing
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handlePublish(draft.id)}
                        disabled={isPublishing === draft.id}
                      >
                        <Send className="h-4 w-4 mr-2" />
                        {isPublishing === draft.id ? "Publishing..." : "Publish Now"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setDraftToDelete(draft.id)}
                        className="text-destructive focus:text-destructive text-destructive-foreground focus:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Draft
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Quick action buttons for mobile */}
              <div className="flex gap-2 mt-4 sm:hidden">
                <Link href={`/projects/${draft.id}/edit`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </Link>
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => handlePublish(draft.id)}
                  disabled={isPublishing === draft.id}
                >
                  <Send className="h-4 w-4 mr-2" />
                  Publish
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <AlertDialog open={!!draftToDelete} onOpenChange={(open) => !open && setDraftToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the draft. This action cannot be undone.
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
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
