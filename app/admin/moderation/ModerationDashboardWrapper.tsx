"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const ModerationDashboard = dynamic(() => import("./ModerationDashboardNew"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center min-h-100">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  ),
});

export default ModerationDashboard;
