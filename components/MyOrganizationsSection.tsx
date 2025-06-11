"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Shield, UserRoundCog, UserRound, BadgeCheck, Users, ExternalLink } from "lucide-react";
import { NoAvatar } from "@/components/NoAvatar";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface Organization {
  id: string;
  name: string;
  username: string;
  type: string;
  verified: boolean;
  logo_url: string | null;
  description: string | null;
}

interface OrganizationMembership {
  role: 'admin' | 'staff' | 'member';
  organizations: Organization;
}

interface MyOrganizationsSectionProps {
  memberships: OrganizationMembership[];
}

export function MyOrganizationsSection({ memberships }: MyOrganizationsSectionProps) {
  if (memberships.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>My Organizations</CardTitle>
          <CardDescription>
            Organizations where you are a member, staff, or admin
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="font-medium text-lg">No Organizations Yet</h3>
            <p className="text-muted-foreground max-w-md mt-1">
              Join organizations to manage their volunteer projects and collaborate with other members.
            </p>
            <Button variant="outline" size="sm" className="mt-4" asChild>
              <Link href="/home">Discover Organizations</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>My Organizations</CardTitle>
        <CardDescription>
          Organizations where you are a member, staff, or admin
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          {memberships.map((membership) => {
            const org = membership.organizations;
            return (
              <Link 
                href={`/organization/${org.username}`} 
                key={org.id} 
                className="relative block group"
              >
                {/* Gradient background behind the card */}
                <div className="absolute inset-0 h-full w-full bg-gradient-to-r from-primary/20 via-primary/10 to-primary/5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                
                <Card className="relative h-full hover:shadow-md transition-all duration-300 border-border/50 group-hover:border-primary/30">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      {/* Left side: Avatar and Info */}
                      <div className="flex items-center gap-3">
                        <Avatar className="h-12 w-12 border-2 border-background flex-shrink-0">
                          {org.logo_url ? (
                            <AvatarImage src={org.logo_url} alt={org.name} />
                          ) : (
                            <AvatarFallback>
                              <NoAvatar fullName={org.name} className="text-sm" />
                            </AvatarFallback>
                          )}
                        </Avatar>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-base truncate group-hover:text-primary transition-colors">
                              {org.name}
                            </h3>
                            {org.verified && (
                              <BadgeCheck 
                                className="h-4 w-4 flex-shrink-0" 
                                fill="hsl(var(--primary))" 
                                stroke="hsl(var(--popover))" 
                                strokeWidth={2.5} 
                              />
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground truncate">
                            @{org.username}
                          </p>
                          {org.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {org.description}
                            </p>
                          )}
                        </div>
                      </div>
                      
                      {/* Right side: Badges and External Link Icon */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="flex flex-col gap-1">
                          <Badge variant="outline" className="text-xs capitalize">
                            {org.type}
                          </Badge>
                          <Badge 
                            variant={
                              membership.role === "admin" ? "default" : 
                              membership.role === "staff" ? "secondary" : "outline"
                            }
                            className="text-xs flex items-center gap-1"
                          >
                            {membership.role === "admin" && <Shield className="h-3 w-3" />}
                            {membership.role === "staff" && <UserRoundCog className="h-3 w-3" />}
                            {membership.role === "member" && <UserRound className="h-3 w-3" />}
                            {membership.role.charAt(0).toUpperCase() + membership.role.slice(1)}
                          </Badge>
                        </div>
                        <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
        
        {memberships.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <Button variant="outline" size="sm" className="w-full" asChild>
              <Link href="/organization">
                Manage All Organizations
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
