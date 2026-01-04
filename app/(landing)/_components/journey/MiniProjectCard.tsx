"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NoAvatar } from "@/components/shared/NoAvatar";
import { MapPin, Calendar, Users } from "lucide-react";

interface MiniProjectCardProps {
  title: string;
  location: string;
  date: string;
  spotsLeft: number;
  totalSpots: number;
  creatorName: string;
  creatorAvatar?: string | null;
}

export function MiniProjectCard({
  title,
  location,
  date,
  spotsLeft,
  totalSpots,
  creatorName,
  creatorAvatar,
}: MiniProjectCardProps) {
  return (
    <Card className="p-4 hover:shadow-lg transition-all cursor-pointer h-full flex flex-col">
      <h3 className="text-base font-semibold mb-2 line-clamp-2 pr-4">
        {title}
      </h3>
      <div className="flex items-center gap-2 mb-3">
        <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-xs text-muted-foreground truncate">
          {location}
        </span>
      </div>
      
      <div className="flex flex-wrap gap-2 mb-3">
        <Badge variant="outline" className="gap-1 text-xs">
          <Calendar className="h-3 w-3" />
          {date}
        </Badge>
        <Badge variant="outline" className="gap-1 text-xs">
          <Users className="h-3 w-3" />
          {spotsLeft} of {totalSpots} left
        </Badge>
      </div>

      <div className="mt-auto pt-2">
        <div className="flex items-center gap-2">
          <Avatar className="h-6 w-6">
            <AvatarImage src={creatorAvatar || ""} />
            <AvatarFallback>
              <NoAvatar fullName={creatorName} />
            </AvatarFallback>
          </Avatar>
          <p className="text-xs font-medium truncate">{creatorName}</p>
        </div>
      </div>
    </Card>
  );
}
