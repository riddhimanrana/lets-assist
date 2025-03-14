"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { 
  Building2, 
  CalendarIcon, 
  ExternalLink, 
  Users2, 
  Settings,
  PencilLine 
} from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import JoinCodeDisplay from "./JoinCodeDisplay";
import Link from "next/link";
import LeaveOrganizationDialog from "./LeaveOrganizationDialog";

interface OrganizationHeaderProps {
  organization: any;
  userRole: string | null;
  memberCount: number;
}

export default function OrganizationHeader({ 
  organization, 
  userRole,
  memberCount
}: OrganizationHeaderProps) {
  const router = useRouter();
  const [isHovering, setIsHovering] = useState(false);
  const isMember = !!userRole;
  const isAdmin = userRole === 'admin';
  
  return (
    <>
      <Card className="overflow-hidden border">
        <div 
          className="h-32 md:h-40 bg-muted/30 relative"
          onMouseEnter={() => userRole === 'admin' && setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          {/* Admin actions overlay */}
          {isAdmin && isHovering && (
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
              <Button 
                variant="outline" 
                className="bg-background"
                asChild
              >
                <Link href={`/organization/${organization.username}/edit`}>
                  <Settings className="w-4 h-4 mr-2" />
                  Organization Settings
                </Link>
              </Button>
            </div>
          )}
        </div>
        
        <div className="p-4 md:p-6">
          <div className="flex flex-col md:flex-row gap-4 md:gap-6 -mt-20 md:-mt-24">
            <Avatar 
              className="h-24 w-24 md:h-36 md:w-36 border-4 border-background shadow-md"
              onMouseEnter={() => userRole === 'admin' && setIsHovering(true)}
              onMouseLeave={() => setIsHovering(false)}
            >
              <AvatarImage src={organization.logo_url || undefined} alt={organization.name} />
              <AvatarFallback className="bg-muted text-2xl">
                <Building2 className="h-10 w-10" />
              </AvatarFallback>
            </Avatar>
            
            <div className="mt-auto">
              <div className="flex flex-wrap items-start gap-2 mb-1">
                <h1 className="text-2xl md:text-3xl font-bold">{organization.name}</h1>
                {organization.verified && (
                  <Badge variant="default">Verified</Badge>
                )}
                <Badge variant="outline" className="capitalize">
                  {organization.type}
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm">@{organization.username}</p>
              
              <div className="mt-3 md:mt-4">
                <div className="flex flex-wrap gap-3 md:gap-4 text-sm text-muted-foreground">
                  {/* Join Date */}
                  <div className="flex items-center">
                    <CalendarIcon className="h-4 w-4 mr-1.5" />
                    <span>Created {format(new Date(organization.created_at), "MMM d, yyyy")}</span>
                  </div>
                  
                  {/* Member Count */}
                  <div className="flex items-center">
                    <Users2 className="h-4 w-4 mr-1.5" />
                    <span>{memberCount} {memberCount === 1 ? 'member' : 'members'}</span>
                  </div>
                  
                  {/* Website (if available) */}
                  {organization.website && (
                    <a 
                      href={organization.website.startsWith('http') ? organization.website : `https://${organization.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center hover:underline"
                    >
                      <ExternalLink className="h-4 w-4 mr-1.5" />
                      <span className="truncate max-w-[200px]">
                        {organization.website.replace(/^https?:\/\//, '')}
                      </span>
                    </a>
                  )}
                </div>
                
                {/* Membership status & actions */}
                <div className="mt-4 flex flex-wrap gap-2">
                  {isMember ? (
                    <>
                      <Badge variant={userRole === 'admin' ? 'default' : userRole === 'staff' ? 'secondary' : 'outline'}>
                        {userRole === 'admin' ? 'Admin' : userRole === 'staff' ? 'Staff' : 'Member'}
                      </Badge>
                      
                      {/* Admin actions */}
                      {isAdmin && (
                        <>
                          <Button 
                            size="sm"
                            variant="outline"
                            asChild
                          >
                            <Link href={`/organization/${organization.username}/edit`}>
                              <PencilLine className="h-3.5 w-3.5 mr-1.5" />
                              Edit Organization
                            </Link>
                          </Button>
                          
                          {/* Join code (admin only) */}
                          <JoinCodeDisplay 
                            organizationId={organization.id} 
                            joinCode={organization.join_code} 
                          />
                        </>
                      )}
                      
                      {/* Leave organization button */}
                      {isAdmin ? (
                        <Button 
                          size="sm"
                          variant="outline"
                          asChild
                        >
                          <Link href={`/organization/${organization.username}/edit`}>
                            <Settings className="h-3.5 w-3.5 mr-1.5" />
                            Settings
                          </Link>
                        </Button>
                      ) : (
                        <LeaveOrganizationDialog 
                          organizationId={organization.id}
                          organizationName={organization.name}
                        />
                      )}
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          
          {/* Organization description */}
          {organization.description && (
            <div className="mt-6 text-muted-foreground">
              <p>{organization.description}</p>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
