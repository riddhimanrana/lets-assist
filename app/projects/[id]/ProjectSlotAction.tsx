"use client";

import { CheckCircle2, Clock, Mail, UserPlus, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Spinner } from "@/components/ui/spinner";

export interface ProjectSlotActionProps {
  projectTitle: string;
  creatorEmail?: string | null;
  isCreator: boolean;
  isPast: boolean;
  isCancelled: boolean;
  isLoading: boolean;
  isSignedUp: boolean;
  isRejected: boolean;
  isAttended: boolean;
  isPending: boolean;
  isFull: boolean;
  onClick: () => void;
}

function SlotStateLabel({
  projectTitle,
  creatorEmail,
  isCreator,
  isCancelled,
  isLoading,
  isSignedUp,
  isRejected,
  isAttended,
  isPending,
  isFull,
}: Omit<ProjectSlotActionProps, "isPast" | "onClick">) {
  if (isCreator) {
    return "You are the creator";
  }

  if (isRejected) {
    return (
      <HoverCard>
        <HoverCardTrigger
          render={
            <span className="flex items-center gap-1.5">
              <XCircle aria-hidden="true" />
              Rejected
            </span>
          }
        />
        <HoverCardContent className="grid w-80 gap-3 p-3">
          <p className="text-sm">
            Your signup for this slot has been rejected by the project
            coordinator. Please contact them directly if you have questions.
          </p>
          {creatorEmail && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                window.location.href = `mailto:${creatorEmail}?subject=Regarding rejected signup for: ${projectTitle}`;
              }}
            >
              <Mail data-icon="inline-start" aria-hidden="true" />
              Contact project coordinator
            </Button>
          )}
        </HoverCardContent>
      </HoverCard>
    );
  }

  if (isAttended) {
    return (
      <HoverCard>
        <HoverCardTrigger
          render={
            <span className="flex items-center gap-1.5">
              <CheckCircle2 aria-hidden="true" />
              Attended
            </span>
          }
        />
        <HoverCardContent className="w-80 p-3">
          <p className="text-sm">
            You have been marked as attended for this slot. Attendance records
            cannot be changed.
          </p>
        </HoverCardContent>
      </HoverCard>
    );
  }

  if (isPending) {
    return (
      <HoverCard>
        <HoverCardTrigger
          render={
            <span className="flex items-center gap-1.5">
              <Clock aria-hidden="true" />
              Pending approval
            </span>
          }
        />
        <HoverCardContent className="w-80 p-3">
          <p className="text-sm">
            Your signup for this slot is pending coordinator approval. You can
            still cancel it if your plans change.
          </p>
        </HoverCardContent>
      </HoverCard>
    );
  }

  if (isSignedUp) {
    return (
      <>
        <XCircle data-icon="inline-start" aria-hidden="true" />
        Cancel signup
      </>
    );
  }

  if (isFull) {
    return "Full";
  }

  if (isLoading) {
    return (
      <>
        <Spinner data-icon="inline-start" />
        Processing...
      </>
    );
  }

  if (isCancelled) {
    return "Unavailable";
  }

  return (
    <>
      <UserPlus data-icon="inline-start" aria-hidden="true" />
      Sign up
    </>
  );
}

/**
 * One button per slot. The label carries the slot's state; the page's single
 * filled action lives in the header and the phone sign-up bar.
 */
export function ProjectSlotAction({
  isPast,
  onClick,
  ...state
}: ProjectSlotActionProps) {
  return (
    <Button
      variant={
        state.isSignedUp && !state.isPending
          ? "secondary"
          : state.isRejected
            ? "destructive"
            : "outline"
      }
      onClick={onClick}
      disabled={
        state.isCreator ||
        state.isLoading ||
        state.isCancelled ||
        isPast ||
        state.isRejected ||
        state.isAttended ||
        (!state.isSignedUp && state.isFull)
      }
    >
      {isPast ? "Time passed" : <SlotStateLabel {...state} />}
    </Button>
  );
}
