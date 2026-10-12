"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileCheck, Plus, Search, SearchX } from "lucide-react";
import { PlusIcon, useAnimatedIcon } from "@/components/icons/animated";
import { PageHeader, SectionHeader } from "@/components/layout/PageHeader";
import { EmptyStateIcon } from "@/components/organization/EmptyStateIcon";
import { getOrganizationDirectoryEmptyActions } from "@/components/organization/organization-directory-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TEXT_LINK_CLASS } from "@/lib/text-link";
import type { Organization } from "@/types";
import { CsvVerificationModal } from "./CsvVerificationModal";
import { JoinOrganizationDialog } from "./JoinOrganizationDialog";
import OrganizationCard, { type OrganizationRole } from "./OrganizationCard";

// The earlier card page: two columns from small tablets, three on desktop.
const CARD_GRID =
  "grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3";

// The signup page reads `redirect` and carries it through confirmation.
const SIGN_UP_HREF = "/signup?redirect=/organization";
const SIGN_IN_HREF = "/login?redirect=/organization";
const SIGN_UP_LABEL = "Sign up to join or create an organization";
// The label is long, so it wraps inside the button on a narrow phone.
const SIGN_UP_BUTTON_CLASS =
  "h-auto max-w-full py-2 text-center whitespace-normal";

type OrganizationDisplay = Organization & {
  description?: string | null;
  created_at?: string | null;
  type?: string | null;
  verified?: boolean;
  logo_url?: string | null;
};

type MembershipRow = {
  role: OrganizationRole;
  organizations?: OrganizationDisplay | null;
};

interface OrganizationsDisplayProps {
  organizations: OrganizationDisplay[];
  memberCounts: Record<string, number | null>;
  isLoggedIn: boolean;
  userMemberships: MembershipRow[];
  isTrusted?: boolean;
  applicationStatus?: boolean | null;
  sourceBadge?: "local-only" | "remote-preview";
  previewWarning?: string | null;
}

const SORT_OPTIONS = [
  { label: "Verified first", value: "verified-first" },
  { label: "Newest first", value: "newest" },
  { label: "Oldest first", value: "oldest" },
  { label: "Alphabetical", value: "alphabetical" },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]["value"];

const isSortValue = (value: unknown): value is SortValue =>
  SORT_OPTIONS.some((option) => option.value === value);

const createdAtTime = (value?: string | null) =>
  value ? new Date(value).getTime() : 0;

function matchesSearch(org: OrganizationDisplay, query: string) {
  if (!query) return true;
  return (
    org.name.toLowerCase().includes(query) ||
    org.username.toLowerCase().includes(query) ||
    Boolean(org.description?.toLowerCase().includes(query)) ||
    Boolean(org.type?.toLowerCase().includes(query))
  );
}

function sortOrganizations(list: OrganizationDisplay[], sortBy: SortValue) {
  const result = [...list];
  switch (sortBy) {
    case "verified-first":
      return result.sort((a, b) => {
        if (Boolean(a.verified) === Boolean(b.verified)) {
          return createdAtTime(b.created_at) - createdAtTime(a.created_at);
        }
        return b.verified ? 1 : -1;
      });
    case "newest":
      return result.sort(
        (a, b) => createdAtTime(b.created_at) - createdAtTime(a.created_at),
      );
    case "oldest":
      return result.sort(
        (a, b) => createdAtTime(a.created_at) - createdAtTime(b.created_at),
      );
    case "alphabetical":
      return result.sort((a, b) => a.name.localeCompare(b.name));
  }
}

export default function OrganizationsDisplay({
  organizations,
  memberCounts,
  isLoggedIn,
  userMemberships,
  isTrusted = false,
  applicationStatus = undefined,
  sourceBadge: _sourceBadge = "local-only",
  previewWarning = null,
}: OrganizationsDisplayProps) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortValue>("verified-first");
  const createIcon = useAnimatedIcon();

  const canCreate = isTrusted || applicationStatus === true;
  const emptyActions = getOrganizationDirectoryEmptyActions({
    isLoggedIn,
    canCreate,
  });
  const query = search.toLowerCase().trim();

  const { userOrgs, otherOrgs } = useMemo(() => {
    const roleByOrgId = new Map<string, OrganizationRole>();
    const memberOrgs: OrganizationDisplay[] = [];
    for (const membership of userMemberships) {
      if (!membership.organizations) continue;
      roleByOrgId.set(membership.organizations.id, membership.role);
      memberOrgs.push(membership.organizations);
    }

    return {
      userOrgs: sortOrganizations(
        memberOrgs.filter((org) => matchesSearch(org, query)),
        sortBy,
      ).map((org) => ({ org, role: roleByOrgId.get(org.id) })),
      otherOrgs: sortOrganizations(
        organizations.filter(
          (org) => !roleByOrgId.has(org.id) && matchesSearch(org, query),
        ),
        sortBy,
      ),
    };
  }, [organizations, userMemberships, query, sortBy]);

  const hasAnyOrganization =
    organizations.length > 0 ||
    userMemberships.some((membership) => membership.organizations);
  const hasResults = userOrgs.length > 0 || otherOrgs.length > 0;
  const sortLabel = SORT_OPTIONS.find(
    (option) => option.value === sortBy,
  )?.label;

  return (
    <div className="mx-auto grid w-full max-w-screen-2xl gap-6 px-4 py-8 sm:px-6 lg:gap-8 lg:px-10">
      <div
        data-tour-id="org-header"
        className="flex flex-col gap-4 border-b pb-6 lg:flex-row lg:items-start lg:justify-between"
      >
        <PageHeader
          className="min-w-0 flex-1"
          title="Organizations"
          description="Join or create organizations to collaborate on projects"
          meta={
            isLoggedIn && !canCreate ? (
              applicationStatus === false ? (
                <span>
                  It looks like you already applied for Trusted Member access.
                  Please email support@lets-assist.com for help.
                </span>
              ) : (
                <span>
                  Trusted Member access is required to create organizations.{" "}
                  <Link href="/trusted-member" className={TEXT_LINK_CLASS}>
                    Apply using the Trusted Member form
                  </Link>
                  .
                </span>
              )
            ) : null
          }
        />
        {/* Full-width stacked actions on a phone, one row from sm up. */}
        <div
          className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
          data-tour-id="org-actions"
        >
          {isLoggedIn ? (
            <>
              <CsvVerificationModal>
                <Button variant="outline">
                  <FileCheck data-icon="inline-start" aria-hidden="true" />
                  Verify certificates
                </Button>
              </CsvVerificationModal>
              <JoinOrganizationDialog />
              {canCreate ? (
                <Button asChild {...createIcon.triggerProps}>
                  <Link href="/organization/create">
                    <PlusIcon
                      ref={createIcon.ref}
                      size={16}
                      data-icon="inline-start"
                      aria-hidden="true"
                    />
                    Create organization
                  </Link>
                </Button>
              ) : (
                <Button disabled>
                  <Plus data-icon="inline-start" aria-hidden="true" />
                  Create organization
                </Button>
              )}
            </>
          ) : (
            <>
              <Button asChild className={SIGN_UP_BUTTON_CLASS}>
                <Link href={SIGN_UP_HREF}>{SIGN_UP_LABEL}</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={SIGN_IN_HREF}>Sign in</Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {previewWarning ? (
        <Alert variant="warning">
          <AlertDescription>{previewWarning}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <InputGroup className="sm:max-w-sm">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            placeholder="Search organizations..."
            aria-label="Search organizations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </InputGroup>

        <Select
          value={sortBy}
          onValueChange={(value) => {
            if (isSortValue(value)) setSortBy(value);
          }}
        >
          <SelectTrigger
            aria-label="Sort organizations"
            className="w-full sm:w-44"
          >
            <SelectValue>{sortLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {!hasResults ? (
        hasAnyOrganization && query ? (
          <Empty className="border p-6 sm:p-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                No results for &quot;{search.trim()}&quot;
              </EmptyTitle>
              <EmptyDescription>
                Try a different name or keyword.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={() => setSearch("")}>
                Clear search
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Empty className="border p-6 sm:p-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <EmptyStateIcon name="users" />
              </EmptyMedia>
              <EmptyTitle>No organizations yet</EmptyTitle>
              <EmptyDescription>{emptyActions.description}</EmptyDescription>
            </EmptyHeader>
            {/* Outline buttons: the page header already holds the one filled
                primary for this view. */}
            <EmptyContent className="flex-row flex-wrap justify-center gap-2">
              {emptyActions.signUp ? (
                <Button
                  variant="outline"
                  asChild
                  className={SIGN_UP_BUTTON_CLASS}
                >
                  <Link href={SIGN_UP_HREF}>{SIGN_UP_LABEL}</Link>
                </Button>
              ) : null}
              {emptyActions.signIn ? (
                <Button variant="outline" asChild>
                  <Link href={SIGN_IN_HREF}>Sign in</Link>
                </Button>
              ) : null}
              {emptyActions.join ? <JoinOrganizationDialog /> : null}
              {emptyActions.create ? (
                <Button variant="outline" asChild>
                  <Link href="/organization/create">Create organization</Link>
                </Button>
              ) : null}
            </EmptyContent>
          </Empty>
        )
      ) : (
        <>
          {userOrgs.length > 0 && (
            <section className="grid gap-3">
              <SectionHeader title="Your organizations" />
              <div className={CARD_GRID}>
                {userOrgs.map(({ org, role }) => (
                  <OrganizationCard
                    key={org.id}
                    org={org}
                    memberCount={memberCounts[org.id] ?? null}
                    isUserMember
                    userRole={role}
                    highlightMembership
                  />
                ))}
              </div>
            </section>
          )}

          {otherOrgs.length > 0 && (
            <section className="grid gap-3">
              <SectionHeader title="Discover" />
              <div className={CARD_GRID}>
                {otherOrgs.map((org) => (
                  <OrganizationCard
                    key={org.id}
                    org={org}
                    memberCount={memberCounts[org.id] ?? null}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
