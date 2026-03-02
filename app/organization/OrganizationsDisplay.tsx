"use client";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Building2, Search, Settings2, Check } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { JoinOrganizationDialog } from "./JoinOrganizationDialog";
import { useEffect, useState } from "react";
import OrganizationCard from "./OrganizationCard";
import { CsvVerificationModal } from "./CsvVerificationModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Organization } from "@/types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type OrganizationDisplay = Organization & {
  description?: string | null;
  created_at?: string | null;
  type?: string | null;
  verified?: boolean;
  logo_url?: string | null;
};

type MembershipRow = {
  role: 'admin' | 'staff' | 'member';
  organizations?: OrganizationDisplay | null;
};

interface OrganizationsDisplayProps {
  organizations: OrganizationDisplay[];
  memberCounts: Record<string, number>;
  isLoggedIn: boolean;
  userMemberships: MembershipRow[];
  isTrusted?: boolean;
  applicationStatus?: boolean | null;
}

export default function OrganizationsDisplay({
  organizations,
  memberCounts,
  isLoggedIn,
  userMemberships,
  isTrusted = false,
  applicationStatus = undefined,
}: OrganizationsDisplayProps) {
  const getCreatedAtTime = (value?: string | null) =>
    value ? new Date(value).getTime() : 0;
  const [search, setSearch] = useState("");
  const [filteredOrgs, setFilteredOrgs] = useState(organizations);
  const [userOrgs, setUserOrgs] = useState<OrganizationDisplay[]>([]);
  const [otherOrgs, setOtherOrgs] = useState<OrganizationDisplay[]>([]);
  const [sortBy, setSortBy] = useState("verified-first");

  // Helper function to get user's role for an organization
  const getUserRole = (orgId: string): 'admin' | 'staff' | 'member' | undefined => {
    const membership = userMemberships.find(m => m.organizations?.id === orgId);
    return membership?.role;
  };

  // Simplified search and sort with single useEffect
  useEffect(() => {
    let result = [...organizations];

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase().trim();
      result = result.filter(org =>
        org.name.toLowerCase().includes(searchLower) ||
        org.username.toLowerCase().includes(searchLower) ||
        org.description?.toLowerCase().includes(searchLower) ||
        org.type.toLowerCase().includes(searchLower)
      );
    }

    // Apply sorting
    switch (sortBy) {
      case "verified-first":
        result.sort((a, b) => {
          if (a.verified === b.verified) {
            return getCreatedAtTime(b.created_at) - getCreatedAtTime(a.created_at);
          }
          return b.verified ? 1 : -1;
        });
        break;
      case "newest":
        result.sort((a, b) => getCreatedAtTime(b.created_at) - getCreatedAtTime(a.created_at));
        break;
      case "oldest":
        result.sort((a, b) => getCreatedAtTime(a.created_at) - getCreatedAtTime(b.created_at));
        break;
      case "alphabetical":
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }

    // Separate user's organizations and other organizations
    // Create a map of user memberships for quick lookup
    const membershipMap = new Map();
    userMemberships.forEach(membership => {
      if (membership.organizations) {
        membershipMap.set(membership.organizations.id, membership.role);
      }
    });

    // Separate organizations based on user membership
    const userOrganizations = userMemberships
      .map((membership) => membership.organizations)
      .filter((org): org is OrganizationDisplay => Boolean(org));
    const otherOrgsList = result.filter(org => !membershipMap.has(org.id));

    // Update state
    setUserOrgs(userOrganizations);
    setOtherOrgs(otherOrgsList);

    setFilteredOrgs(result);
  }, [organizations, search, sortBy, isLoggedIn, userMemberships]);

  return (
    <div className="mx-auto px-4 sm:px-8 lg:px-12 py-8">
      <div className="w-full space-y-4 sm:space-y-8">
        {/* Header section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4" data-tour-id="org-header">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Organizations</h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">
              Join or create organizations to collaborate on projects
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2" data-tour-id="org-actions">
            {isLoggedIn && (
              <>
                <CsvVerificationModal />
                <JoinOrganizationDialog />
                {isTrusted || applicationStatus === true ? (
                  <Link href="/organization/create" className={cn(buttonVariants(), "w-full sm:w-auto")}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Organization
                  </Link>
                ) : (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger render={
                        <span className="w-full sm:w-auto inline-flex">
                          <Button
                            className="w-full sm:w-auto cursor-not-allowed opacity-60 pointer-events-none"
                            disabled
                          >
                            <Plus className="w-4 h-4 mr-2" />
                            Create Organization
                          </Button>
                        </span>
                      } />
                      <TooltipContent className="text-xs font-normal max-w-xs">
                        {applicationStatus === false
                          ? "It looks like you already applied for Trusted Member access. Please email support@lets-assist.com for help."
                          : "Trusted Member access is required to create organizations. Apply using the Trusted Member form."}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </>
            )}
            {!isLoggedIn && (
              <Link href="/login?redirect=/organization" className={cn(buttonVariants({ variant: "outline" }), "w-full sm:w-auto")}>
                Sign In to Join or Create
              </Link>
            )}
          </div>
        </div>

        <Separator />

        {/* Search and filter section */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search organizations..."
              className="pl-9 pr-4"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger render={
              <Button variant="outline">
                <Settings2 className="mr-2 h-4 w-4" />
                Filter & Sort
              </Button>
            } />
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Sort By</DropdownMenuLabel>
                {[
                  { label: "Verified First", value: "verified-first" },
                  { label: "Newest First", value: "newest" },
                  { label: "Oldest First", value: "oldest" },
                  { label: "Alphabetical", value: "alphabetical" },
                ].map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    className="flex items-center justify-between"
                    onClick={() => setSortBy(option.value)}
                  >
                    {option.label}
                    {sortBy === option.value && <Check className="h-4 w-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Organizations grid */}
        {filteredOrgs.length === 0 ? (
          <div className="text-center py-8 sm:py-16">
            <Building2 className="mx-auto h-10 sm:h-12 w-10 sm:w-12 text-muted-foreground" />
            <h3 className="mt-3 sm:mt-4 text-base sm:text-lg font-semibold">
              {search ? `No results for "${search}"` : "No organizations yet"}
            </h3>
            <p className="mt-2 text-sm sm:text-base text-muted-foreground">
              {search ? "Try different keywords or filters" : "Be the first to create an organization!"}
            </p>
            {isLoggedIn && !search && (
              (isTrusted || applicationStatus === true) ? (
                <Link href="/organization/create" className={cn(buttonVariants(), "mt-4")}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Organization
                </Link>
              ) : (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger render={
                      <span className="mt-4 inline-flex">
                        <Button className="cursor-not-allowed opacity-60 pointer-events-none" disabled>
                          <Plus className="w-4 h-4 mr-2" />
                          Create Organization
                        </Button>
                      </span>
                    } />
                    <TooltipContent className="text-xs font-normal max-w-xs">
                      {applicationStatus === false
                        ? "It looks like you already applied for Trusted Member access. Please email support@lets-assist.com for help."
                        : "Trusted Member access is required to create organizations. Apply using the Trusted Member form."}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-8">
            {/* My Organizations Section */}
            {userOrgs.length > 0 && (
              <div>
                <h2 className="text-lg sm:text-xl font-semibold mb-4">
                  My Organizations
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                  {userOrgs.map((org) => (
                    <OrganizationCard
                      key={org.id}
                      org={org}
                      memberCount={memberCounts[org.id] || 0}
                      isUserMember={true}
                      userRole={getUserRole(org.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Other Organizations Section */}
            {otherOrgs.length > 0 && (
              <div>
                <h2 className="text-lg sm:text-xl font-semibold mb-4">
                  Discover Organizations
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                  {otherOrgs.map((org) => (
                    <OrganizationCard
                      key={org.id}
                      org={org}
                      memberCount={memberCounts[org.id] || 0}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
