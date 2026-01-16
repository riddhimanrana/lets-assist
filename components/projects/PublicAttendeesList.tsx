"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { ProfileHoverCard } from "@/components/shared/ProfileHoverCard";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { cn } from "@/lib/utils";

export interface PublicAttendee {
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

interface PublicAttendeesListProps {
  attendees: PublicAttendee[];
  /** Optional custom title, defaults to "Attendees" */
  title?: string;
  /** If true, list starts collapsed */
  defaultCollapsed?: boolean;
}

/**
 * Displays a collapsible list of public attendees with their names, comments, and profile hover cards.
 * Handles both logged-in users (with profile tooltips) and anonymous users.
 */
export function PublicAttendeesList({ 
  attendees, 
  title = "Attendees",
  defaultCollapsed = true
}: PublicAttendeesListProps) {
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);

  if (attendees.length === 0) {
    return null;
  }

  return (
    <Card className="border shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-lg font-semibold">{title}</h3>
            <Badge variant="secondary" className="ml-1">
              {attendees.length}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="gap-1"
          >
            {isExpanded ? (
              <>
                Hide <ChevronUp className="h-4 w-4" />
              </>
            ) : (
              <>
                Show <ChevronDown className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>

        {isExpanded && (
          <div className="space-y-3 mt-4">
            {attendees.map((attendee) => {
              const displayName = attendee.is_anonymous 
                ? attendee.anonymous_name 
                : attendee.full_name;

              return (
                <div 
                  key={attendee.signup_id}
                  className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                >
                  <ProfileHoverCard
                    username={attendee.username}
                    fullName={attendee.full_name}
                    avatarUrl={attendee.avatar_url || undefined}
                    disabled={attendee.is_anonymous}
                  >
                    <div className={cn(
                      "flex items-center gap-2",
                      !attendee.is_anonymous && "cursor-pointer hover:opacity-80"
                    )}>
                      <Avatar className="h-9 w-9">
                        {attendee.avatar_url && !attendee.is_anonymous ? (
                          <AvatarImage src={attendee.avatar_url} alt={displayName} />
                        ) : null}
                        <AvatarFallback>
                          <NoAvatar fullName={displayName} className="text-sm" />
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {displayName}
                        </p>
                        {attendee.is_anonymous && (
                          <p className="text-xs text-muted-foreground">
                            Anonymous
                          </p>
                        )}
                      </div>
                    </div>
                  </ProfileHoverCard>

                  {attendee.volunteer_comment && (
                    <div className="flex-1 ml-2">
                      <div className="text-xs text-muted-foreground mb-1">Comment:</div>
                      <p className="text-sm bg-muted/40 rounded px-3 py-2 border whitespace-pre-wrap break-words">
                        {attendee.volunteer_comment}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
