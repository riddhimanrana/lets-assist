"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";

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

    if (inviteStatus) {
      if (inviteStatus === "success") {
        toast.success("Staff invite applied", {
          description: `You were added to "${inviteOrg}" as staff.`,
          duration: 5000,
        });
      } else if (inviteStatus === "invalid_token") {
        toast.warning("Invite could not be applied", {
          description: `The invite link for "${inviteOrg}" is no longer valid.`,
          duration: 5000,
        });
      } else if (inviteStatus === "expired_token") {
        toast.warning("Invite expired", {
          description: `The staff invite for "${inviteOrg}" has expired.`,
          duration: 5000,
        });
      } else if (inviteStatus === "org_not_found") {
        toast.warning("Invite could not be applied", {
          description: `The organization "${inviteOrg}" could not be found.`,
          duration: 5000,
        });
      } else {
        toast.warning("Invite processing issue", {
          description: `You signed in, but we could not process your invite for "${inviteOrg}".`,
          duration: 5000,
        });
      }

      params.delete("invite_status");
      params.delete("invite_org");
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
