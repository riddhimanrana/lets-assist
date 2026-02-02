"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { ProfileHoverCard } from "@/components/shared/ProfileHoverCard";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export interface SlotAttendee {
  signup_id: string;
  schedule_id: string;
  user_id: string | null;
  full_name: string;
  username: string;
  avatar_url: string;
  volunteer_comment: string;
  is_anonymous: boolean;
  anonymous_name: string;
}

interface SlotAttendeesDropdownProps {
  attendees: SlotAttendee[];
  /** If true, starts in expanded state */
  defaultOpen?: boolean;
}

/**
 * Small dropdown showing who signed up for a specific slot.
 * Integrated into each volunteer opportunity time slot.
 */
export function SlotAttendeesDropdown({
  attendees,
  defaultOpen = false
}: SlotAttendeesDropdownProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (attendees.length === 0) {
    return null;
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full mt-2">
      <CollapsibleTrigger render={
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1.5 hover:bg-muted/50 w-full justify-start"
        >
          <Users className="h-3 w-3" />
          <span>{attendees.length} signed up</span>
          {isOpen ? (
            <ChevronUp className="h-3 w-3 ml-auto" />
          ) : (
            <ChevronDown className="h-3 w-3 ml-auto" />
          )}
        </Button>
      } />

      <CollapsibleContent className="mt-2">
        <div className="space-y-2.5 pl-2 pr-1 py-2">
          {attendees.map((attendee) => {
            const displayName = attendee.is_anonymous
              ? attendee.anonymous_name
              : attendee.full_name;

            return (
              <div
                key={attendee.signup_id}
                className="text-xs"
              >
                <ProfileHoverCard
                  username={attendee.username}
                  fullName={attendee.full_name}
                  avatarUrl={attendee.avatar_url || undefined}
                  disabled={attendee.is_anonymous}
                >
                  <div className={cn(
                    "flex items-center gap-2",
                    !attendee.is_anonymous && "cursor-pointer hover:text-foreground"
                  )}>
                    <Avatar className="h-6 w-6 shrink-0">
                      {attendee.avatar_url && !attendee.is_anonymous ? (
                        <AvatarImage src={attendee.avatar_url} alt={displayName} />
                      ) : null}
                      <AvatarFallback className="text-[9px]">
                        <NoAvatar fullName={displayName} className="text-[9px]" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-foreground">
                        {displayName}
                      </span>
                      {attendee.is_anonymous && (
                        <span className="text-[10px] text-muted-foreground/70">(Anon)</span>
                      )}
                    </div>
                  </div>
                </ProfileHoverCard>

                {attendee.volunteer_comment && (
                  <div className="mt-1.5 ml-8">
                    <p className="text-xs text-muted-foreground bg-background/60 rounded px-2.5 py-1.5 border border-border/60 wrap-break-word leading-relaxed">
                      {attendee.volunteer_comment}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
