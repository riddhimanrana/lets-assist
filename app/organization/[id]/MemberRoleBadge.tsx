import { Shield, UserRound, UserRoundCog } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/**
 * The one role badge: members table, member details, organization header and
 * the directory (through `OrganizationRoleBadge`). Admin is the primary green
 * label, Staff uses the semantic blue tint, and Member stays outlined.
 * Any role other than admin or staff reads as Member.
 */
export function MemberRoleBadge({ role }: { role: string }) {
  switch (role) {
    case "admin":
      return (
        <Badge variant="default">
          <Shield aria-hidden="true" />
          Admin
        </Badge>
      );
    case "staff":
      return (
        <Badge variant="info">
          <UserRoundCog aria-hidden="true" />
          Staff
        </Badge>
      );
    default:
      return (
        <Badge variant="outline">
          <UserRound className="text-muted-foreground" aria-hidden="true" />
          Member
        </Badge>
      );
  }
}
