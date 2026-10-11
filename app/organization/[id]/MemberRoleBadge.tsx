import { Shield, UserRound, UserRoundCog } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/**
 * The one role badge: members table, member details, organization header and
 * the directory (through `OrganizationRoleBadge`). The label always sits on a
 * neutral badge so it stays readable; only the icon carries the role colour.
 * Any role other than admin or staff reads as Member.
 */
export function MemberRoleBadge({ role }: { role: string }) {
  switch (role) {
    case "admin":
      return (
        <Badge variant="secondary">
          <Shield className="text-primary" aria-hidden="true" />
          Admin
        </Badge>
      );
    case "staff":
      return (
        <Badge variant="outline">
          <UserRoundCog className="text-info" aria-hidden="true" />
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
