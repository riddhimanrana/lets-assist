import { Shield, UserRound, UserRoundCog } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/** Role badge shared by the members table and the member details panel. */
export function MemberRoleBadge({ role }: { role: string }) {
  switch (role) {
    case "admin":
      return (
        <Badge variant="secondary">
          <Shield />
          Admin
        </Badge>
      );
    case "staff":
      return (
        <Badge variant="outline">
          <UserRoundCog />
          Staff
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <UserRound />
          Member
        </Badge>
      );
  }
}
