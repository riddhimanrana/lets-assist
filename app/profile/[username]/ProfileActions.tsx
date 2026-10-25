"use client";

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreVertical, Flag } from "lucide-react";
import { ReportContentButton } from "@/components/feedback/ReportContentButton";

interface ProfileActionsProps {
  profileId: string;
  profileName: string;
  profileUsername: string;
}

export function ProfileActions({
  profileId,
  profileName,
  profileUsername,
}: ProfileActionsProps) {
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="Open menu">
              <MoreVertical aria-hidden="true" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setReportOpen(true)}>
            <Flag aria-hidden="true" />
            Report profile
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ReportContentButton
        contentType="profile"
        contentId={profileId}
        contentTitle={profileName || profileUsername}
        contentCreator={profileName || profileUsername}
        open={reportOpen}
        onOpenChange={setReportOpen}
        showTrigger={false}
      />
    </>
  );
}
