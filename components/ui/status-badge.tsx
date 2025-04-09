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
import { formatStatusText } from "@/utils/project";

interface StatusBadgeProps extends Omit<BadgeProps, "variant"> {
  status: ProjectStatus;
  showIcon?: boolean;
  className?: string;
}

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
      className: "bg-chart-3/10 text-chart-3 hover:bg-chart-3/20",
    },
    "in-progress": {
      variant: "default" as const,
      icon: ClockIcon,
      className: "bg-chart-4/10 text-chart-4 hover:bg-chart-4/20",
    },
    completed: {
      variant: "default" as const,
      icon: CheckCircle2,
      className: "bg-chart-5/10 text-chart-5 hover:bg-chart-5/20",
    },
    cancelled: {
      variant: "destructive" as const,
      icon: XCircle,
      className: "bg-destructive/10 text-destructive hover:bg-destructive/20",
    },
  };
  const defaultConfig = {
    variant: "default" as const,
    icon: AlertCircle,
    className: "bg-gray-200 text-gray-600",
  };
  // Use the config for the status if it exists, otherwise use default
  const config = statusConfig[status] || defaultConfig;
  const Icon = config.icon;
  // Format status for display
  const displayStatus = formatStatusText(status);

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
