"use client";

import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Users2, ExternalLink, BadgeCheck, Shield, UserRoundCog, UserRound } from "lucide-react";
import { NoAvatar } from "@/components/NoAvatar";

import type { Organization } from "@/types";

interface OrganizationCardProps {
  org: Organization & { website?: string };
  memberCount: number;
  isUserMember?: boolean;
  userRole?: 'admin' | 'staff' | 'member';
}

export default function OrganizationCard({ org, memberCount, isUserMember = false, userRole }: OrganizationCardProps) {
  return (
    <Link href={`/organization/${org.username}`}>
      <Card className={`h-full overflow-hidden hover:shadow-md transition-shadow ${isUserMember ? 'border-primary/30 bg-primary/5' : ''}`}>
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
            
            {isUserMember && userRole && (
              <div className="absolute top-2 right-2">
                <Badge 
                  variant={
                    userRole === "admin" ? "default" : 
                    userRole === "staff" ? "secondary" : "outline"
                  }
                  className="text-xs flex items-center gap-1"
                >
                  {userRole === "admin" && <Shield className="h-3 w-3" />}
                  {userRole === "staff" && <UserRoundCog className="h-3 w-3" />}
                  {userRole === "member" && <UserRound className="h-3 w-3" />}
                  {userRole.charAt(0).toUpperCase() + userRole.slice(1)}
                </Badge>
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
            <span>{memberCount} members</span>
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
  );
}
