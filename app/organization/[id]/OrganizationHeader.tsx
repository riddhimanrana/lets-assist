"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShareIcon, GlobeIcon, UsersIcon, Plus, Building2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import JoinCodeDialog from "./JoinCodeDialog";
import { toast } from "sonner";

interface OrganizationHeaderProps {
  organization: any;
  userRole: string | null;
  memberCount: number;
}

export default function OrganizationHeader({
  organization,
  userRole,
  memberCount,
}: OrganizationHeaderProps) {
  const [showJoinCode, setShowJoinCode] = useState(false);
  const isAdmin = userRole === "admin";
  
  const getInitials = (name: string) => {
    return name
      ? name.split(' ').map(part => part[0]).join('').toUpperCase().substring(0, 2)
      : "ORG";
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: organization.name,
        text: organization.description || `Check out ${organization.name} on Let's Assist!`,
        url: window.location.href,
      }).catch(err => {
        console.error('Error sharing:', err);
        navigator.clipboard.writeText(window.location.href);
        toast.success('Link copied to clipboard!');
      });
    } else {
      navigator.clipboard.writeText(window.location.href);
      toast.success('Link copied to clipboard!');
    }
  };

  return (
    <div className="flex flex-col w-full gap-4 relative">
      {/* Main container - stacking on mobile, row on desktop */}
      <div className="flex flex-col items-center sm:flex-row sm:items-start gap-4 sm:gap-6 w-full">
      {/* Avatar - smaller on mobile */}
      <Avatar className="h-16 w-16 sm:h-24 sm:w-24 rounded-2xl border-4 border-background shadow-sm flex-shrink-0">
        <AvatarImage src={organization.logo_url || undefined} alt={organization.name} />
        <AvatarFallback className="text-base sm:text-xl bg-primary/10 rounded-2xl">
        {organization.type === 'company' ? 
          <Building2 className="h-8 w-8 text-primary/60" /> : 
          getInitials(organization.name)}
        </AvatarFallback>
      </Avatar>
      
      {/* Organization details - centered on mobile */}
      <div className="flex-1 min-w-0 text-center sm:text-left">
        {/* Organization name and badges */}
        <div>
        <h1 className="text-xl sm:text-3xl font-bold tracking-tight line-clamp-2 sm:line-clamp-1">
          {organization.name}
        </h1>
        
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-2">
          <Badge variant="outline" className="capitalize">
          {organization.type}
          </Badge>
          
          {organization.username && (
          <Badge variant="secondary" className="font-mono">
            @{organization.username}
          </Badge>
          )}
        </div>
        </div>
        
        {/* Website and member count - wrap properly on mobile */}
        <div className="flex flex-wrap justify-center sm:justify-start gap-3 mt-3 items-center text-sm text-muted-foreground">
        {organization.website && (
          <a 
          href={organization.website.startsWith('http') ? organization.website : `https://${organization.website}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
          <GlobeIcon className="h-3.5 w-3.5" />
          <span className="truncate max-w-[150px] sm:max-w-[200px]">
            {organization.website.replace(/^https?:\/\/(www\.)?/, '')}
          </span>
          </a>
        )}
        
        <div className="flex items-center gap-1">
          <UsersIcon className="h-3.5 w-3.5" />
          <span>{memberCount} {memberCount === 1 ? 'Member' : 'Members'}</span>
        </div>
        </div>
        
        {/* Description - more height on mobile with fade out */}
        {organization.description && (
        <p className="mt-3 text-sm text-muted-foreground line-clamp-3 sm:line-clamp-none">
          {organization.description}
        </p>
        )}
      </div>
      </div>

      {/* Action buttons - positioned bottom right on desktop */}
      <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto sm:absolute sm:bottom-0 sm:right-0">
      <Button 
        variant="outline"
        size="sm"
        className="w-full sm:w-auto justify-center"
        onClick={handleShare}
      >
        <ShareIcon className="h-4 w-4 mr-2" />
        Share
      </Button>
      
      {isAdmin && (
        <Button 
        variant="default"
        size="sm"
        className="w-full sm:w-auto justify-center"
        onClick={() => setShowJoinCode(true)}
        >
        <Plus className="h-4 w-4 mr-2" />
        Invite Members
        </Button>
      )}
      
      {userRole === null && (
        <Button 
        variant="default"
        size="sm"
        asChild
        className="w-full sm:w-auto justify-center"
        >
        <Link href={`/organization/join?id=${organization.id}`}>
          <Plus className="h-4 w-4 mr-2" />
          Join Organization
        </Link>
        </Button>
      )}
      </div>
      
      {/* Action buttons - full width on mobile
      <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto sm:ml-auto">
        <Button 
          variant="outline"
          size="sm"
          className="w-full sm:w-auto justify-center"
          onClick={handleShare}
        >
          <ShareIcon className="h-4 w-4 mr-2" />
          Share
        </Button>
        
        {isAdmin && (
          <Button 
            variant="default"
            size="sm"
            className="w-full sm:w-auto justify-center"
            onClick={() => setShowJoinCode(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Invite Members
          </Button>
        )}
        
        {userRole === null && (
          <Button 
            variant="default"
            size="sm"
            asChild
            className="w-full sm:w-auto justify-center"
          >
            <Link href={`/organization/join?id=${organization.id}`}>
              <Plus className="h-4 w-4 mr-2" />
              Join Organization
            </Link>
          </Button>
        )}
      </div> */}
      
      {showJoinCode && isAdmin && (
        <JoinCodeDialog 
          organization={organization} 
          open={showJoinCode} 
          onOpenChange={setShowJoinCode} 
        />
      )}
    </div>
  );
}
