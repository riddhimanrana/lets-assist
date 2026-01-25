"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Calendar,
  MapPin,
  Edit,
  Trash2,
  MoreVertical,
  FileText,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import type { ProjectSchedule, EventType } from "@/types";
import { deleteDraft, publishDraft } from "./actions";
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

interface DraftsSidebarProps {
  initialDrafts: Draft[];
}

export default function DraftsSidebar({ initialDrafts }: DraftsSidebarProps) {
  const router = useRouter();
  const [drafts, setDrafts] = useState(initialDrafts);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState<string | null>(null);
  const [isOpenDesktop, setIsOpenDesktop] = useState(false);
  const [isOpenMobile, setIsOpenMobile] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState<string | null>(null);

  const handleDelete = async (draftId: string) => {
    setIsDeleting(draftId);
    try {
      const result = await deleteDraft(draftId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Draft deleted");
        // Update local state and keep the sheet/drawer open
        setDrafts(prevDrafts => prevDrafts.filter((d) => d.id !== draftId));
        setDeleteDialogOpen(null);
        // Refresh the page data in the background
        router.refresh();
      }
    } catch (error) {
      console.error("Delete error:", error);
      toast.error("Failed to delete draft");
    } finally {
      setIsDeleting(null);
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
        // Update local state
        setDrafts(prevDrafts => prevDrafts.filter((d) => d.id !== draftId));
        router.push(`/projects/${result.id}`);
      }
    } catch (error) {
      console.error("Publish error:", error);
      toast.error("Failed to publish project");
    } finally {
      setIsPublishing(null);
    }
  };

  const handleContinue = (draftId: string) => {
    setIsOpenDesktop(false);
    setIsOpenMobile(false);
    router.push(`/projects/create?draft=${draftId}`);
  };

  const getSchedulePreview = (draft: Draft) => {
    const schedule = draft.schedule;
    if (!schedule) return "No schedule";

    if (draft.event_type === "oneTime" && schedule.oneTime?.date) {
      return format(new Date(schedule.oneTime.date), "MMM d");
    }
    if (draft.event_type === "multiDay") {
      const days = schedule.multiDay?.length ?? 0;
      return days > 0 ? `${days} days` : "Incomplete";
    }
    if (draft.event_type === "sameDayMultiArea" && schedule.sameDayMultiArea?.date) {
      return format(new Date(schedule.sameDayMultiArea.date), "MMM d");
    }
    return "Incomplete";
  };

  const DraftItem = ({ draft }: { draft: Draft }) => (
    <Card className="overflow-hidden cursor-pointer hover:bg-muted/60 transition" onClick={() => handleContinue(draft.id)}>
      <CardContent className="p-3">
        <div className="flex gap-3">
          {/* Thumbnail */}
          <div className="w-12 h-12 bg-muted rounded shrink-0">
            {draft.cover_image_url ? (
              <Image
                src={draft.cover_image_url}
                alt={draft.title}
                fill
                className="object-cover rounded"
                sizes="48px"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm truncate">
              {draft.title || "Untitled"}
            </h4>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
              <div className="flex items-center gap-0.5">
                <Calendar className="h-3 w-3" />
                {getSchedulePreview(draft)}
              </div>
              {draft.location && (
                <div className="flex items-center gap-0.5 truncate max-w-[150px]">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="truncate">{draft.location}</span>
                </div>
              )}
            </div>
            {draft.organization && (
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {draft.organization.name}
              </p>
            )}
          </div>

          {/* Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger render={
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={(e) => e.stopPropagation()}>
                <MoreVertical className="h-3 w-3" />
              </Button>
            } />
            <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  handleContinue(draft.id);
                }}
              >
                <Edit className="h-4 w-4 mr-2" />
                Continue Editing
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  handlePublish(draft.id);
                }}
                disabled={isPublishing === draft.id}
              >
                <Send className="h-4 w-4 mr-2" />
                {isPublishing === draft.id ? "Publishing..." : "Publish"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteDialogOpen(draft.id);
                }}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );

  const DraftList = () => (
    <div className="space-y-3 max-h-[calc(100vh-200px)] overflow-y-auto pr-2">
      {drafts.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
          <p className="text-sm font-medium">No drafts yet</p>
          <p className="text-xs text-muted-foreground mt-1">Save your current project as draft to see it here</p>
        </div>
      ) : (
        drafts.map((draft) => (
          <DraftItem key={draft.id} draft={draft} />
        ))
      )}
    </div>
  );

  return (
    <>
      <TooltipProvider>
        {/* Delete confirmation dialog */}
        <AlertDialog open={!!deleteDialogOpen} onOpenChange={(open) => {
          if (!open) setDeleteDialogOpen(null);
        }}>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete draft?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this draft.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={(e) => {
                e.stopPropagation();
                setDeleteDialogOpen(null);
              }}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.stopPropagation();
                  if (deleteDialogOpen) {
                    handleDelete(deleteDialogOpen);
                  }
                }}
                disabled={!!isDeleting}
                className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Mobile drawer trigger (icon only) */}
        <div className="md:hidden">
          <Drawer open={isOpenMobile} onOpenChange={setIsOpenMobile}>
            <Tooltip>
              <TooltipTrigger render={
                <DrawerTrigger asChild>
                  <Button variant="secondary" size="icon" className="h-9 w-9">
                    <FileText className="h-4 w-4" />
                  </Button>
                </DrawerTrigger>
              } />
              <TooltipContent>
                <p>My Drafts ({drafts.length})</p>
              </TooltipContent>
            </Tooltip>
            <DrawerContent>
              <DrawerHeader className="pb-2">
                <DrawerTitle>My Drafts</DrawerTitle>
                <DrawerDescription>
                  {drafts.length} draft{drafts.length !== 1 ? "s" : ""} saved
                </DrawerDescription>
              </DrawerHeader>
              <div className="px-4 pb-6 pt-2">
                <DraftList />
              </div>
            </DrawerContent>
          </Drawer>
        </div>

        {/* Desktop sheet trigger */}
        <div className="hidden md:block">
          <Sheet open={isOpenDesktop} onOpenChange={setIsOpenDesktop}>
            <Tooltip>
              <TooltipTrigger render={
                <SheetTrigger render={
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-9 w-9"
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                } />
              } />
              <TooltipContent>
                <p>My Drafts ({drafts.length})</p>
              </TooltipContent>
            </Tooltip>
            <SheetContent side="right" className="w-full sm:max-w-md">
              <SheetHeader>
                <SheetTitle>My Drafts</SheetTitle>
                <SheetDescription>
                  {drafts.length} draft{drafts.length !== 1 ? "s" : ""} saved
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6">
                <DraftList />
              </div>
            </SheetContent>
          </Sheet>
        </div >
      </TooltipProvider >
    </>
  );
}
