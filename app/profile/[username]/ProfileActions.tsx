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
  profileUsername 
}: ProfileActionsProps) {
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={
          <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2">
            <MoreVertical className="h-4 w-4" />
            <span className="sr-only">Open menu</span>
          </Button>
        } />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setTimeout(() => setReportOpen(true), 100)}>
            <Flag className="mr-2 h-4 w-4" />
            <span>Report Profile</span>
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
