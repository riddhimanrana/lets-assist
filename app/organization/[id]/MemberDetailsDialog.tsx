"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { NoAvatar } from "@/components/shared/NoAvatar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

import { MemberDetailsBody } from "./MemberDetailsBody";
import { MemberRoleBadge } from "./MemberRoleBadge";
import {
  downloadMemberDetailsCsv,
  type MemberEventDetail,
} from "./member-details-export";
import { getMemberEventDetails } from "./member-hours-actions";
import type { MemberHoursPeriod } from "./members-shared";

type MemberProfile = {
  id?: string;
  username?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
};

type MemberDetailsMember = {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
  profiles?: MemberProfile | MemberProfile[] | null;
};

interface MemberDetailsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  member: MemberDetailsMember | null;
  organizationId: string;
  demoMemberDetails?: Record<
    string,
    {
      events: MemberEventDetail[];
      totalHours: number;
    }
  >;
}

/**
 * Member hours and event history. Opens as a side sheet on desktop and a
 * bottom drawer on phones.
 */
export default function MemberDetailsDialog({
  isOpen,
  onClose,
  member,
  organizationId,
  demoMemberDetails,
}: MemberDetailsDialogProps) {
  const isMobile = useIsMobile();
  const [events, setEvents] = useState<MemberEventDetail[]>([]);
  const [totalHours, setTotalHours] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [dateRange, setDateRange] = useState<MemberHoursPeriod>(undefined);

  useEffect(() => {
    if (!isOpen || !member) return;

    let cancelled = false;
    const fetchMemberDetails = async () => {
      setLoading(true);
      setError(null);

      const demoDetails = demoMemberDetails?.[member.user_id];
      if (demoDetails) {
        const filteredEvents =
          dateRange?.from && dateRange?.to
            ? demoDetails.events.filter((event) => {
                const eventDate = new Date(event.eventDate);
                return (
                  eventDate >= dateRange.from! && eventDate < dateRange.to!
                );
              })
            : demoDetails.events;

        setEvents(filteredEvents);
        setTotalHours(
          filteredEvents.reduce((sum, event) => sum + event.hours, 0),
        );
        setLoading(false);
        return;
      }

      try {
        const dateRangeParam =
          dateRange?.from && dateRange?.to
            ? { from: dateRange.from, to: dateRange.to }
            : undefined;
        const result = await getMemberEventDetails(
          organizationId,
          member.user_id,
          dateRangeParam,
        );
        if (cancelled) return;

        if (result.error) {
          setError(result.error);
        } else {
          setEvents(result.events);
          setTotalHours(result.totalHours);
        }
      } catch (err) {
        console.error("Error fetching member details:", err);
        if (!cancelled) setError("Failed to load member details");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchMemberDetails();

    return () => {
      cancelled = true;
    };
  }, [isOpen, member, organizationId, dateRange, demoMemberDetails]);

  if (!member) return null;

  const profile = Array.isArray(member.profiles)
    ? member.profiles[0]
    : member.profiles;
  const memberName = profile?.full_name || "Unknown User";

  const handleExportMemberData = () => {
    if (events.length === 0) {
      toast.error("No data to export");
      return;
    }

    setIsExporting(true);
    try {
      downloadMemberDetailsCsv({
        memberName,
        username: profile?.username || "",
        role: member.role,
        joinedAt: member.joined_at,
        events,
        totalHours,
        dateRange,
      });
      toast.success(`${memberName}'s volunteer data exported successfully`);
    } catch (exportError) {
      console.error("Error exporting member data:", exportError);
      toast.error("Failed to export member data");
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  const avatar = (
    <Avatar className="size-10 shrink-0">
      <AvatarImage
        src={profile?.avatar_url || undefined}
        alt={profile?.full_name || ""}
      />
      <AvatarFallback className="text-primary text-sm">
        <NoAvatar fullName={profile?.full_name || ""} />
      </AvatarFallback>
    </Avatar>
  );
  const meta = (
    <span className="flex flex-wrap items-center gap-2">
      {profile?.username ? <span>@{profile.username}</span> : null}
      <MemberRoleBadge role={member.role} />
    </span>
  );
  const body = (
    <MemberDetailsBody
      joinedAt={member.joined_at}
      events={events}
      totalHours={totalHours}
      loading={loading}
      error={error}
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      isExporting={isExporting}
      onExport={handleExportMemberData}
    />
  );

  if (isMobile) {
    return (
      <Drawer open={isOpen} onOpenChange={handleOpenChange}>
        <DrawerContent>
          <DrawerHeader className="flex-row items-center gap-3 border-b text-left">
            {avatar}
            <div className="grid min-w-0 gap-1">
              <DrawerTitle className="truncate text-lg font-semibold">
                {memberName}
              </DrawerTitle>
              <DrawerDescription asChild>
                <div>{meta}</div>
              </DrawerDescription>
            </div>
          </DrawerHeader>
          <div className="overflow-y-auto p-4">{body}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader className="flex-row items-center gap-3 border-b pr-12">
          {avatar}
          <div className="grid min-w-0 gap-1">
            <SheetTitle className="truncate text-lg font-semibold">
              {memberName}
            </SheetTitle>
            <SheetDescription render={<div />}>{meta}</SheetDescription>
          </div>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">{body}</div>
      </SheetContent>
    </Sheet>
  );
}
