"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Building2, Users2, ExternalLink, Search, Settings2, Check, BadgeCheck, X } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";
import { NoAvatar } from "@/components/NoAvatar";
import { JoinOrganizationDialog } from "./JoinOrganizationDialog";
import { useEffect, useState } from "react";
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
}

export default function OrganizationsDisplay({ 
  organizations, 
  memberCounts,
  isLoggedIn 
}: OrganizationsDisplayProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filteredOrgs, setFilteredOrgs] = useState(organizations);
  const [sortBy, setSortBy] = useState("verified-first");

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
    
    setFilteredOrgs(result);
  }, [organizations, search, sortBy]);

  return (
    <div className="mx-auto px-4 sm:px-8 lg:px-12 py-8">
      <div className="w-full max-w-7xl space-y-4 sm:space-y-8">
        {/* Header section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Organizations</h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">
              Join or create organizations to collaborate on projects
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            {isLoggedIn && (
              <>
                <JoinOrganizationDialog />
                <Button className="w-full sm:w-auto" asChild>
                  <Link href="/organization/create">
                    <Plus className="w-4 h-4 mr-2" />
                    Create Organization
                  </Link>
                </Button>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {filteredOrgs.map((org) => (
              <Link href={`/organization/${org.username}`} key={org.id}>
                <Card className="h-full overflow-hidden hover:shadow-md transition-shadow">
                  <CardContent className="p-0">
                    <div className="h-20 sm:h-24 bg-gradient-to-r from-primary/40 via-primary/20 to-primary/10 relative">
                      {org.logo_url && (
                        <div className="absolute bottom-0 left-4 transform translate-y-1/2">
                          <Avatar className="h-12 w-12 sm:h-14 sm:w-14 rounded-full border-4 border-background">
                            <AvatarImage src={org.logo_url} alt={org.name} />
                            <AvatarFallback>
                              <NoAvatar fullName={org.name} className="text-base" />
                            </AvatarFallback>
                          </Avatar>
                        </div>
                      )}
                      {!org.logo_url && (
                        <div className="absolute bottom-0 left-4 transform translate-y-1/2 rounded-full bg-muted border-4 border-background h-12 w-12 sm:h-14 sm:w-14 flex items-center justify-center">
                          <Building2 className="h-5 w-5 sm:h-6 sm:w-6 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    
                    <div className="pt-8 sm:pt-10 px-3 sm:px-4 pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-1">
                            <h3 className="font-semibold text-base sm:text-lg line-clamp-1">{org.name}</h3>
                            {org.verified && (
                              <BadgeCheck className="h-6 w-6" fill="hsl(var(--primary))" stroke="hsl(var(--popover))" strokeWidth={2.5} />
                            )}
                          </div>
                          <p className="text-xs sm:text-sm text-muted-foreground">@{org.username}</p>
                        </div>
                        <Badge variant="outline" className="text-xs capitalize">
                          {org.type}
                        </Badge>
                      </div>
                      
                      <p className="mt-2 text-xs sm:text-sm line-clamp-1 text-muted-foreground">
                        {org.description || "No description provided"}
                      </p>
                    </div>
                  </CardContent>
                  
                  <CardFooter className="px-3 sm:px-4 py-2 sm:py-3 flex justify-between border-t bg-muted/10">
                    <div className="flex items-center text-xs sm:text-sm text-muted-foreground">
                      <Users2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5" />
                      <span>{memberCounts[org.id] || 0} members</span>
                    </div>
                    
                    {org.website && (
                      <div className="flex items-center text-xs sm:text-sm">
                        <ExternalLink className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5" />
                        <span className="max-w-[100px] sm:max-w-[150px] truncate">
                          {org.website.replace(/^https?:\/\//, '')}
                        </span>
                      </div>
                    )}
                  </CardFooter>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
