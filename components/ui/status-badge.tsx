import React from "react";
import { Badge, BadgeProps } from "./badge";
import {
  Clock,
  ClockIcon,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ProjectStatus } from "@/types";

interface StatusBadgeProps extends Omit<BadgeProps, "variant"> {
  status: ProjectStatus;
  showIcon?: boolean;
  className?: string;
}

// Default config if status is not recognized
const defaultConfig = {
  variant: "outline" as const,
  icon: AlertCircle,
  className: "bg-muted/50 text-muted-foreground hover:bg-muted",
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  showIcon = true,
  className,
  ...props
}) => {
  const statusConfig = {
    upcoming: {
      variant: "secondary" as const,
      icon: Clock,
      className: "bg-blue-500/10 text-blue-500 hover:bg-blue-500/20",
    },
    "in-progress": {
      variant: "default" as const,
      icon: ClockIcon,
      className: "bg-green-500/10 text-green-500 hover:bg-green-500/20",
    },
    completed: {
      variant: "outline" as const,
      icon: CheckCircle2,
      className: "bg-green-500/10 text-green-500 hover:bg-green-500/20",
    },
    cancelled: {
      variant: "destructive" as const,
      icon: XCircle,
      className: "bg-destructive/10 text-destructive hover:bg-destructive/20",
    },
  };

  // Use the config for the status if it exists, otherwise use default
  const config = statusConfig[status] || defaultConfig;
  const Icon = config.icon;

  // Ensure status is a valid string for display
  const displayStatus = status ? status.charAt(0).toUpperCase() + status.slice(1).replace("-", " ") : "Unknown";

  return (
    <Badge
      variant={config.variant}
      className={cn(
        "font-medium",
        config.className,
        showIcon && "gap-1.5",
        className
      )}
      {...props}
    >
      {showIcon && <Icon className="h-3.5 w-3.5" />}
      {displayStatus}
    </Badge>
  );
};

export const ProjectStatusBadge: React.FC<{
  status: ProjectStatus;
  size?: "sm" | "default";
  className?: string;
}> = ({ status, size = "default", className }) => {
  return (
    <StatusBadge
      status={status}
      className={cn(
        size === "sm" && "text-xs py-0",
        "capitalize whitespace-nowrap",
        className
      )}
    />
  );
};
