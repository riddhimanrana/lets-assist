import React from "react";
import { Badge, badgeVariants } from "./badge";
import { VariantProps } from "class-variance-authority";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ProjectStatus } from "@/types";
import { formatStatusText } from "@/utils/project";

type BadgeProps = React.ComponentProps<typeof Badge> &
  VariantProps<typeof badgeVariants>;

type StatusVariant = "info" | "warning" | "success" | "destructive" | "neutral";

interface StatusBadgeProps extends Omit<BadgeProps, "variant"> {
  status: ProjectStatus;
  showIcon?: boolean;
  className?: string;
}

/**
 * Project statuses use the flat status tints from the design system. Each
 * state also has its own icon and label, so color is never the only signal.
 */
const STATUS_PRESENTATION: Record<
  ProjectStatus,
  { variant: StatusVariant; icon: LucideIcon }
> = {
  upcoming: { variant: "info", icon: CalendarClock },
  "in-progress": { variant: "warning", icon: Clock },
  completed: { variant: "success", icon: CheckCircle2 },
  cancelled: { variant: "destructive", icon: XCircle },
};

const UNKNOWN_PRESENTATION = {
  variant: "neutral" as const,
  icon: AlertCircle,
};

/** Own keys only, so "constructor" or "__proto__" never match a status. */
export function getProjectStatusPresentation(status: string) {
  return Object.hasOwn(STATUS_PRESENTATION, status)
    ? STATUS_PRESENTATION[status as ProjectStatus]
    : UNKNOWN_PRESENTATION;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  showIcon = true,
  className,
  ...props
}) => {
  const { variant, icon: Icon } = getProjectStatusPresentation(status);

  return (
    <Badge variant={variant} className={className} {...props}>
      {showIcon && <Icon aria-hidden="true" data-icon="inline-start" />}
      {formatStatusText(status)}
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
      // The badge already keeps one line and never shrinks; `sm` only trims
      // vertical padding for dense rows.
      className={cn(size === "sm" && "py-0", className)}
    />
  );
};
