"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

import { AdminPage } from "../components/AdminPage";

const ModerationDashboard = dynamic(() => import("./ModerationDashboardNew"), {
  ssr: false,
  loading: () => (
    <AdminPage>
      <div className="grid gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </AdminPage>
  ),
});

export default ModerationDashboard;
