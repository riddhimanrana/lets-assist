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
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
      <CollapsibleTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-7 px-2 text-xs gap-1.5 hover:bg-muted/50"
        >
          <Users className="h-3.5 w-3.5" />
          <span>{attendees.length} signed up</span>
          {isOpen ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </Button>
      </CollapsibleTrigger>
      
      <CollapsibleContent className="mt-2">
        <div className="space-y-2 border rounded-lg p-3 bg-muted/20">
          {attendees.map((attendee) => {
            const displayName = attendee.is_anonymous 
              ? attendee.anonymous_name 
              : attendee.full_name;

            return (
              <div 
                key={attendee.signup_id}
                className="flex items-start gap-2 text-sm"
              >
                <ProfileHoverCard
                  username={attendee.username}
                  fullName={attendee.full_name}
                  avatarUrl={attendee.avatar_url || undefined}
                  disabled={attendee.is_anonymous}
                >
                  <div className={cn(
                    "flex items-center gap-2",
                    !attendee.is_anonymous && "cursor-pointer hover:underline"
                  )}>
                    <Avatar className="h-6 w-6">
                      {attendee.avatar_url && !attendee.is_anonymous ? (
                        <AvatarImage src={attendee.avatar_url} alt={displayName} />
                      ) : null}
                      <AvatarFallback className="text-[10px]">
                        <NoAvatar fullName={displayName} className="text-[10px]" />
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium">
                      {displayName}
                    </span>
                    {attendee.is_anonymous && (
                      <span className="text-xs text-muted-foreground">(Anonymous)</span>
                    )}
                  </div>
                </ProfileHoverCard>

                {attendee.volunteer_comment && (
                  <div className="flex-1 ml-1">
                    <p className="text-xs text-muted-foreground bg-background/50 rounded px-2 py-1 border whitespace-pre-wrap break-words">
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
