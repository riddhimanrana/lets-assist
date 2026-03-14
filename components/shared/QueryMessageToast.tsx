"use client";

import React, { Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  getStaffInviteToastContent,
  type StaffInviteStatus,
  type StaffInviteToastPosition,
} from "@/lib/organization/staff-invite-outcome";

const STAFF_INVITE_STATUSES: StaffInviteStatus[] = [
  "success",
  "invalid_token",
  "expired_token",
  "org_not_found",
  "error",
];

const STAFF_INVITE_TOAST_POSITIONS: StaffInviteToastPosition[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "top-center",
  "bottom-center",
];

function QueryMessageToastContent() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!mounted) return;

    let hasParamUpdates = false;
    const params = new URLSearchParams(searchParams.toString());

    const deleted = searchParams.get("deleted");
    if (deleted === "true") {
      toast.success("Account successfully deleted", {
        description: "We're sorry to see you go. You can always create a new account later.",
        duration: 5000,
      });

      params.delete("deleted");
      params.delete("noRedirect");
      hasParamUpdates = true;
    }

    const inviteStatus = searchParams.get("invite_status");
    const inviteOrg = searchParams.get("invite_org") ?? "your organization";
    const inviteToastPositionParam = searchParams.get("invite_toast_position");

    const inviteToastPosition = STAFF_INVITE_TOAST_POSITIONS.includes(
      inviteToastPositionParam as StaffInviteToastPosition,
    )
      ? (inviteToastPositionParam as StaffInviteToastPosition)
      : undefined;

    if (
      inviteStatus &&
      STAFF_INVITE_STATUSES.includes(inviteStatus as StaffInviteStatus)
    ) {
      const inviteToastContent = getStaffInviteToastContent(
        inviteStatus as StaffInviteStatus,
        inviteOrg,
      );

      const toastOptions = {
        description: inviteToastContent.description,
        duration: 5000,
        ...(inviteToastPosition ? { position: inviteToastPosition } : {}),
      };

      if (inviteStatus === "success") {
        toast.success(inviteToastContent.title, toastOptions);
      } else {
        toast.warning(inviteToastContent.title, toastOptions);
      }

      params.delete("invite_status");
      params.delete("invite_org");
      params.delete("invite_toast_position");
      hasParamUpdates = true;
    }

    if (hasParamUpdates) {
      const newQuery = params.toString() ? `?${params.toString()}` : "";
      router.replace(`${pathname}${newQuery}`, { scroll: false });
    }
  }, [mounted, searchParams, router, pathname]);

  return null;
}

export function QueryMessageToast() {
  return (
    <Suspense fallback={null}>
      <QueryMessageToastContent />
    </Suspense>
  );
}
