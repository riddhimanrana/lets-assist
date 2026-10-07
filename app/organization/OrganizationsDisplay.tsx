"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  Building2,
  ChevronRight,
  FileCheck,
  MoreHorizontal,
  Plus,
  Search,
  SearchX,
} from "lucide-react";
import { PageHeader, SectionHeader } from "@/components/layout/PageHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NoAvatar } from "@/components/shared/NoAvatar";
import type { Organization } from "@/types";
import { CsvVerificationModal } from "./CsvVerificationModal";
import { JoinOrganizationDialog } from "./JoinOrganizationDialog";
import OrganizationCard, {
  OrganizationRoleBadge,
  type OrganizationRole,
} from "./OrganizationCard";

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
  const verifyTriggerRef = useRef<HTMLButtonElement>(null);

  const canCreate = isTrusted || applicationStatus === true;
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
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-6">
      <div data-tour-id="org-header">
        <PageHeader
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
                  <Link
                    href="/trusted-member"
                    className="text-foreground underline underline-offset-4"
                  >
                    Apply using the Trusted Member form
                  </Link>
                  .
                </span>
              )
            ) : null
          }
          actions={
            <div
              className="flex flex-wrap items-center gap-2"
              data-tour-id="org-actions"
            >
              {isLoggedIn ? (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="More actions"
                        >
                          <MoreHorizontal />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="start" className="w-52">
                      <DropdownMenuItem
                        onClick={() => verifyTriggerRef.current?.click()}
                      >
                        <FileCheck />
                        Verify certificates
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <JoinOrganizationDialog />
                  {canCreate ? (
                    <Button asChild>
                      <Link href="/organization/create">
                        <Plus data-icon="inline-start" />
                        Create Organization
                      </Link>
                    </Button>
                  ) : (
                    <Button disabled>
                      <Plus data-icon="inline-start" />
                      Create Organization
                    </Button>
                  )}
                </>
              ) : (
                <Button variant="outline" asChild>
                  <Link href="/login?redirect=/organization">
                    Sign in to join or create
                  </Link>
                </Button>
              )}
            </div>
          }
        />
      </div>

      {/* The certificate checker keeps its own dialog; the menu item above
          opens it through this hidden trigger so the dialog outlives the menu. */}
      {isLoggedIn ? (
        <CsvVerificationModal>
          <button ref={verifyTriggerRef} type="button" hidden tabIndex={-1} />
        </CsvVerificationModal>
      ) : null}

      {previewWarning ? (
        <Alert variant="warning">
          <AlertDescription>{previewWarning}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <InputGroup className="sm:max-w-sm">
          <InputGroupAddon>
            <Search />
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
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX />
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
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Building2 />
              </EmptyMedia>
              <EmptyTitle>No organizations yet</EmptyTitle>
              <EmptyDescription>
                {canCreate
                  ? "Be the first to create an organization."
                  : "Organizations will show up here once they are created."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      ) : (
        <>
          {userOrgs.length > 0 && (
            <section className="grid gap-3">
              <SectionHeader title="Your organizations" />
              <Card className="py-0">
                <ItemGroup className="gap-0">
                  {userOrgs.map(({ org, role }, index) => (
                    <Fragment key={org.id}>
                      {index > 0 ? <ItemSeparator className="my-0" /> : null}
                      <Item
                        className="rounded-none"
                        render={<Link href={`/organization/${org.username}`} />}
                      >
                        <ItemMedia>
                          <Avatar size="lg">
                            <AvatarImage
                              src={org.logo_url || undefined}
                              alt={org.name}
                            />
                            <AvatarFallback>
                              <NoAvatar fullName={org.name} />
                            </AvatarFallback>
                          </Avatar>
                        </ItemMedia>
                        <ItemContent className="min-w-0">
                          <ItemTitle className="max-w-full">
                            <span className="truncate">{org.name}</span>
                            {org.verified && (
                              <BadgeCheck
                                role="img"
                                aria-label="Verified organization"
                                className="text-primary size-4 shrink-0"
                              />
                            )}
                          </ItemTitle>
                          <ItemDescription className="line-clamp-1">
                            @{org.username}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          {role ? <OrganizationRoleBadge role={role} /> : null}
                          <ChevronRight className="text-muted-foreground size-4" />
                        </ItemActions>
                      </Item>
                    </Fragment>
                  ))}
                </ItemGroup>
              </Card>
            </section>
          )}

          {otherOrgs.length > 0 && (
            <section className="grid gap-3">
              <SectionHeader title="Discover" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
