"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import Image from "next/image";
import { FileText, Loader2, MoreVertical, Save } from "lucide-react";
import { toast } from "sonner";

import { FoldersIcon, useAnimatedIcon } from "@/components/icons/animated";
import { Badge } from "@/components/ui/badge";
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Item, ItemActions, ItemGroup, ItemMedia } from "@/components/ui/item";
import type { ProjectSchedule, EventType } from "@/types";
import { deleteDraft, publishDraft } from "./actions";

export interface Draft {
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

/**
 * The header button that opens the drafts panel. It is its own component so
 * the drawer and the sheet each get an icon that plays on their own trigger.
 */
function DraftsTrigger({
  count,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ...props
}: { count: number } & React.ComponentProps<typeof Button>) {
  const icon = useAnimatedIcon();

  return (
    <Button
      variant="outline"
      {...props}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        icon.triggerProps.onMouseEnter();
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event);
        icon.triggerProps.onMouseLeave();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        icon.triggerProps.onFocus();
      }}
      onBlur={(event) => {
        onBlur?.(event);
        icon.triggerProps.onBlur();
      }}
    >
      <FoldersIcon
        ref={icon.ref}
        size={16}
        data-icon="inline-start"
        aria-hidden="true"
      />
      Drafts
      {count > 0 ? (
        <Badge variant="secondary" className="tabular-nums">
          {count}
        </Badge>
      ) : null}
    </Button>
  );
}

interface DraftsSidebarProps {
  initialDrafts: Draft[];
  /** Saves the project being edited as a new draft. */
  onSaveDraft: () => void;
  isSavingDraft: boolean;
  saveDraftDisabled: boolean;
  /** Why saving is unavailable right now, shown under the button. */
  saveDraftBlockedReason?: string;
}

export default function DraftsSidebar({
  initialDrafts,
  onSaveDraft,
  isSavingDraft,
  saveDraftDisabled,
  saveDraftBlockedReason,
}: DraftsSidebarProps) {
  const router = useRouter();
  const [drafts, setDrafts] = useState(initialDrafts);
  // The server sends a fresh list after a draft is saved; show it.
  const [syncedDrafts, setSyncedDrafts] = useState(initialDrafts);
  if (syncedDrafts !== initialDrafts) {
    setSyncedDrafts(initialDrafts);
    setDrafts(initialDrafts);
  }
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
        setDrafts((prevDrafts) => prevDrafts.filter((d) => d.id !== draftId));
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
      const result = await publishDraft(draftId);
      if ("error" in result && result.error) {
        toast.error(result.error);
      } else if ("success" in result && result.success && result.id) {
        toast.success("Project published successfully!");
        // Update local state
        setDrafts((prevDrafts) => prevDrafts.filter((d) => d.id !== draftId));
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
    if (
      draft.event_type === "sameDayMultiArea" &&
      schedule.sameDayMultiArea?.date
    ) {
      return format(new Date(schedule.sameDayMultiArea.date), "MMM d");
    }
    return "Incomplete";
  };

  const renderDraft = (draft: Draft) => (
    <Item key={draft.id} variant="outline" size="sm" className="flex-nowrap">
      {draft.cover_image_url ? (
        <ItemMedia variant="image">
          <Image
            src={draft.cover_image_url}
            alt=""
            width={40}
            height={40}
            sizes="40px"
          />
        </ItemMedia>
      ) : null}
      <button
        type="button"
        onClick={() => handleContinue(draft.id)}
        className="group/draft focus-visible:ring-ring/50 flex min-h-9 min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-sm text-left outline-none focus-visible:ring-[3px]"
      >
        <span className="truncate text-sm leading-snug font-medium underline-offset-4 group-hover/draft:underline">
          {draft.title || "Untitled"}
        </span>
        <span className="text-muted-foreground truncate text-sm">
          {getSchedulePreview(draft)}
          {draft.location ? ` · ${draft.location}` : ""}
        </span>
        {draft.organization && (
          <span className="text-muted-foreground truncate text-sm">
            {draft.organization.name}
          </span>
        )}
      </button>
      <ItemActions>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Actions for ${draft.title || "Untitled"}`}
              >
                <MoreVertical aria-hidden="true" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => handleContinue(draft.id)}>
              Continue editing
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handlePublish(draft.id)}
              disabled={isPublishing === draft.id}
            >
              {isPublishing === draft.id ? "Publishing..." : "Publish"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setDeleteDialogOpen(draft.id)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  );

  const draftCountLabel = `${drafts.length} draft${drafts.length !== 1 ? "s" : ""} saved`;

  // The panel body, shared by the phone drawer and the desktop sheet.
  const panelBody = (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Button
          variant="outline"
          onClick={onSaveDraft}
          disabled={saveDraftDisabled}
          className="w-full"
        >
          {isSavingDraft ? (
            <Loader2
              data-icon="inline-start"
              aria-hidden="true"
              className="animate-spin"
            />
          ) : (
            <Save data-icon="inline-start" aria-hidden="true" />
          )}
          Save as new draft
        </Button>
        {saveDraftBlockedReason ? (
          <p className="text-muted-foreground text-sm">
            {saveDraftBlockedReason}
          </p>
        ) : null}
      </div>

      {drafts.length === 0 ? (
        <Empty className="border py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileText />
            </EmptyMedia>
            <EmptyTitle>No drafts yet</EmptyTitle>
            <EmptyDescription>
              Save your current project as a draft and it will appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup className="max-h-[calc(100vh-280px)] gap-2 overflow-y-auto">
          {drafts.map(renderDraft)}
        </ItemGroup>
      )}
    </div>
  );

  return (
    <>
      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!deleteDialogOpen}
        onOpenChange={(open) => {
          if (!open) setDeleteDialogOpen(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this draft.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialogOpen(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteDialogOpen) {
                  handleDelete(deleteDialogOpen);
                }
              }}
              disabled={!!isDeleting}
              variant="destructive"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Phone: drawer */}
      <div className="md:hidden">
        <Drawer open={isOpenMobile} onOpenChange={setIsOpenMobile}>
          <DrawerTrigger asChild>
            <DraftsTrigger count={drafts.length} />
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader className="pb-2">
              <DrawerTitle>My drafts</DrawerTitle>
              <DrawerDescription>{draftCountLabel}</DrawerDescription>
            </DrawerHeader>
            <div className="px-4 pt-2 pb-6">{panelBody}</div>
          </DrawerContent>
        </Drawer>
      </div>

      {/* Desktop: sheet */}
      <div className="hidden md:block">
        <Sheet open={isOpenDesktop} onOpenChange={setIsOpenDesktop}>
          <SheetTrigger render={<DraftsTrigger count={drafts.length} />} />
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle>My drafts</SheetTitle>
              <SheetDescription>{draftCountLabel}</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-4">{panelBody}</div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
