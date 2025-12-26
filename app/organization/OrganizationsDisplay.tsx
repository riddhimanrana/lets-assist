"use client";


import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Building2, Search, Settings2, Check } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";
import { JoinOrganizationDialog } from "./JoinOrganizationDialog";
import { useEffect, useState } from "react";
import OrganizationCard from "./OrganizationCard";
import { CsvVerificationModal } from "./CsvVerificationModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface OrganizationsDisplayProps {
  organizations: any[];
  memberCounts: Record<string, number>;
  isLoggedIn: boolean;
  userMemberships: any[];
  isTrusted?: boolean;
  applicationStatus?: boolean | null;
}

import { TrustedInfoIcon } from "@/components/TrustedInfoIcon";

export default function OrganizationsDisplay({ 
  organizations, 
  memberCounts,
  isLoggedIn,
  userMemberships,
  isTrusted = false,
  applicationStatus = undefined,
}: OrganizationsDisplayProps) {

  const [search, setSearch] = useState("");
  const [filteredOrgs, setFilteredOrgs] = useState(organizations);
  const [userOrgs, setUserOrgs] = useState<any[]>([]);
  const [otherOrgs, setOtherOrgs] = useState<any[]>([]);
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
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          }
          return b.verified ? 1 : -1;
        });
        break;
      case "newest":
        result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
      case "oldest":
        result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
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
    const userOrganizations = userMemberships.map(membership => membership.organizations).filter(Boolean);
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Organizations</h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">
              Join or create organizations to collaborate on projects
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            {isLoggedIn && (
              <>
                <CsvVerificationModal />
                <JoinOrganizationDialog />
                <div className="flex items-center gap-2">
                  {isTrusted || applicationStatus === true ? (
                    <Button className="w-full sm:w-auto" asChild>
                      <Link href="/organization/create">
                        <Plus className="w-4 h-4 mr-2" />
                        Create Organization
                      </Link>
                    </Button>
                  ) : (
                    <Button className="w-full sm:w-auto cursor-not-allowed opacity-60" disabled>
                      <Plus className="w-4 h-4 mr-2" />
                      Create Organization
                    </Button>
                  )}
                  {!isTrusted && applicationStatus !== true && (
                    <TrustedInfoIcon
                      message={
                        applicationStatus === false
                          ? "It looks like you've already applied to be a Trusted Member. Please email support@lets-assist.com for further assistance."
                          : "You must be a Trusted Member to create organizations. Apply using the form."
                      }
                    />
                  )}
                </div>
              </>
            )}
            {!isLoggedIn && (
              <Button className="w-full sm:w-auto" asChild variant="outline">
                <Link href="/login?redirect=/organization">
                  Sign In to Join or Create
                </Link>
              </Button>
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
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Settings2 className="mr-2 h-4 w-4" />
                Filter & Sort
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
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
              <Button asChild className="mt-4">
                <Link href="/organization/create">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Organization
                </Link>
              </Button>
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
                  {userOrgs.map((org: any) => (
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
                  {otherOrgs.map((org: any) => (
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
