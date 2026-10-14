import { createRoot } from "react-dom/client";
import OrgModerationDashboard from "../../../app/organization/[id]/moderation/OrgModerationDashboard";

createRoot(document.getElementById("root")!).render(
  <main className="mx-auto w-full max-w-6xl bg-background px-4 py-8 text-foreground sm:px-6">
    <OrgModerationDashboard
      organizationId="fictional-moderation-organization"
      initialStats={{
        total: 0,
        pending: 0,
        blocked: 0,
        critical: 0,
        recentWeek: 0,
      }}
      initialFlagged={[]}
    />
  </main>,
);
