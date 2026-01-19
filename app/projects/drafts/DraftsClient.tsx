"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  AlertDialogTrigger,
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
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState<string | null>(null);

  const handleDelete = async (draftId: string) => {
    setIsDeleting(draftId);
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
    } finally {
      setIsDeleting(null);
    }
  };

  const handlePublish = async (draftId: string) => {
    setIsPublishing(draftId);
    try {
      const result = await publishDraft(draftId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Project published successfully!");
        router.push(`/projects/${draftId}`);
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
          <Button asChild>
            <Link href="/projects/create">
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Link>
          </Button>
        </div>
        
        <Card className="text-center py-12">
          <CardContent>
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No drafts yet</h3>
            <p className="text-muted-foreground mb-4">
              Start creating a project and save it as a draft to continue later.
            </p>
            <Button asChild>
              <Link href="/projects/create">Create Your First Project</Link>
            </Button>
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
        <Button asChild>
          <Link href="/projects/create">
            <Plus className="h-4 w-4 mr-2" />
            New Project
          </Link>
        </Button>
      </div>

      <div className="space-y-4">
        {drafts.map((draft) => (
          <Card key={draft.id} className="overflow-hidden">
            <div className="flex flex-col sm:flex-row">
              {/* Cover image or placeholder */}
              <div className="sm:w-48 h-32 sm:h-auto bg-muted flex-shrink-0">
                {draft.cover_image_url ? (
                  <img
                    src={draft.cover_image_url}
                    alt={draft.title}
                    className="w-full h-full object-cover"
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
                      <Badge variant="secondary" className="flex-shrink-0">
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
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="flex-shrink-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/projects/${draft.id}/edit`}>
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
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem
                            onSelect={(e) => e.preventDefault()}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete Draft
                          </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete &quot;{draft.title || "Untitled Draft"}&quot;.
                              This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(draft.id)}
                              disabled={isDeleting === draft.id}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              {isDeleting === draft.id ? "Deleting..." : "Delete"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Quick action buttons for mobile */}
                <div className="flex gap-2 mt-4 sm:hidden">
                  <Button asChild variant="outline" size="sm" className="flex-1">
                    <Link href={`/projects/${draft.id}/edit`}>
                      <Edit className="h-4 w-4 mr-2" />
                      Edit
                    </Link>
                  </Button>
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
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
