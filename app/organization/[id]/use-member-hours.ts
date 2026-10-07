"use client";

import { useEffect, useState } from "react";

import { getOrganizationMembers } from "./admin/actions";
import { getMemberVolunteerHours } from "./member-hours-actions";
import type {
  MemberDirectoryMap,
  MemberHoursMap,
  MemberHoursPeriod,
} from "./members-shared";

/** Loads hours per member for staff and admins, for the chosen period. */
export function useMemberHours({
  organizationId,
  enabled,
  dateRange,
  demoMemberHours,
}: {
  organizationId: string;
  enabled: boolean;
  dateRange: MemberHoursPeriod;
  demoMemberHours?: MemberHoursMap;
}) {
  const [memberHours, setMemberHours] = useState<MemberHoursMap>({});
  const [loadingHours, setLoadingHours] = useState(false);

  useEffect(() => {
    if (demoMemberHours) {
      setMemberHours(demoMemberHours);
      setLoadingHours(false);
      return;
    }
    if (!enabled || !organizationId) return;

    let cancelled = false;
    const load = async () => {
      setLoadingHours(true);
      try {
        const dateRangeParam =
          dateRange?.from && dateRange?.to
            ? { from: dateRange.from, to: dateRange.to }
            : undefined;
        const result = await getMemberVolunteerHours(
          organizationId,
          dateRangeParam,
        );
        if (!cancelled && !result.error) {
          setMemberHours(result.memberHours);
        }
      } catch (error) {
        console.error("Error loading member hours:", error);
      } finally {
        if (!cancelled) setLoadingHours(false);
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [demoMemberHours, enabled, organizationId, dateRange]);

  return { memberHours, loadingHours };
}

/**
 * Loads the staff-only directory fields (email, status, last activity) that
 * used to live on the separate members directory page.
 */
export function useMemberDirectory({
  organizationId,
  enabled,
}: {
  organizationId: string;
  enabled: boolean;
}) {
  const [directory, setDirectory] = useState<MemberDirectoryMap>({});
  const [loadingDirectory, setLoadingDirectory] = useState(enabled);

  useEffect(() => {
    if (!enabled || !organizationId) {
      setLoadingDirectory(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoadingDirectory(true);
      try {
        const rows = await getOrganizationMembers(organizationId);
        if (cancelled) return;
        const next: MemberDirectoryMap = {};
        for (const row of rows) {
          next[row.id] = {
            email: row.email ?? null,
            status: row.status ?? null,
            lastActivityAt: row.lastActivityAt ?? null,
          };
        }
        setDirectory(next);
      } catch (error) {
        console.error("Error loading member directory details:", error);
      } finally {
        if (!cancelled) setLoadingDirectory(false);
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [enabled, organizationId]);

  return { directory, loadingDirectory };
}
