"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  CheckCircle, 
  AlertCircle, 
  BarChart3, 
  CircleCheck,
  UserCheck
} from "lucide-react";

export type HoursType = "all" | "verified" | "unverified";

interface HoursTypeToggleProps {
  value: HoursType;
  onChange: (value: HoursType) => void;
  verifiedCount?: number;
  unverifiedCount?: number;
  className?: string;
}

export function HoursTypeToggle({ 
  value, 
  onChange, 
  verifiedCount = 0, 
  unverifiedCount = 0,
  className 
}: HoursTypeToggleProps) {
  const options = [
    {
      value: "all" as const,
      label: "All Hours",
      icon: BarChart3,
      description: "Show both verified and self-reported hours",
      count: verifiedCount + unverifiedCount,
      color: "default"
    },
    {
      value: "verified" as const,
      label: "Verified",
      icon: CircleCheck,
      description: "Let's Assist verified hours only",
      count: verifiedCount,
      color: "default"
    },
    {
      value: "unverified" as const,
      label: "Self-Reported",
      icon: UserCheck,
      description: "Unverified self-reported hours only",
      count: unverifiedCount,
      color: "secondary"
    }
  ] as const;

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {options.map((option) => {
        const Icon = option.icon;
        const isSelected = value === option.value;
        
        return (
          <Button
            key={option.value}
            variant={isSelected ? "default" : "outline"}
            size="sm"
            onClick={() => onChange(option.value)}
            className="gap-2 relative"
          >
            <Icon className="h-4 w-4" />
            <span>{option.label}</span>
            {option.count > 0 && (
              <Badge 
                variant={isSelected ? "secondary" : "default"}
                className="ml-1 text-xs h-5 px-1.5"
              >
                {option.count}
              </Badge>
            )}
          </Button>
        );
      })}
    </div>
  );
}

// Enhanced version with descriptions
interface HoursTypeToggleWithDescriptionsProps extends HoursTypeToggleProps {
  showDescriptions?: boolean;
  layout?: "horizontal" | "vertical";
}

export function HoursTypeToggleWithDescriptions({ 
  value, 
  onChange, 
  verifiedCount = 0, 
  unverifiedCount = 0,
  showDescriptions = true,
  layout = "horizontal",
  className 
}: HoursTypeToggleWithDescriptionsProps) {
  const options = [
    {
      value: "all" as const,
      label: "All Hours",
      icon: BarChart3,
      description: "Combined view of verified and self-reported hours",
      count: verifiedCount + unverifiedCount,
      bgColor: "bg-primary/10",
      textColor: "text-primary"
    },
    {
      value: "verified" as const,
      label: "Let's Assist Verified",
      icon: CheckCircle,
      description: "Hours from verified Let's Assist projects and organizations",
      count: verifiedCount,
      bgColor: "bg-green-100 dark:bg-green-900/20",
      textColor: "text-green-700 dark:text-green-400"
    },
    {
      value: "unverified" as const,
      label: "Self-Reported",
      icon: AlertCircle,
      description: "Hours you've added from activities outside Let's Assist",
      count: unverifiedCount,
      bgColor: "bg-amber-100 dark:bg-amber-900/20",
      textColor: "text-amber-700 dark:text-amber-400"
    }
  ] as const;

  const containerClass = layout === "vertical" 
    ? "flex flex-col gap-3" 
    : "grid grid-cols-1 sm:grid-cols-3 gap-4";

  return (
    <div className={`${containerClass} ${className}`}>
      {options.map((option) => {
        const Icon = option.icon;
        const isSelected = value === option.value;
        
        return (
          <div
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`
              relative cursor-pointer rounded-lg border-2 p-4 transition-all
              ${isSelected 
                ? "border-primary bg-primary/5" 
                : "border-border hover:border-primary/50 hover:bg-muted/50"
              }
            `}
          >
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${option.bgColor}`}>
                <Icon className={`h-5 w-5 ${option.textColor}`} />
              </div>
              
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">{option.label}</h3>
                  {option.count > 0 && (
                    <Badge variant="outline" className="ml-2">
                      {option.count}
                    </Badge>
                  )}
                </div>
                
                {showDescriptions && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {option.description}
                  </p>
                )}
              </div>
            </div>
            
            {/* Selection indicator */}
            {isSelected && (
              <div className="absolute top-2 right-2">
                <div className="h-2 w-2 rounded-full bg-primary"></div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
