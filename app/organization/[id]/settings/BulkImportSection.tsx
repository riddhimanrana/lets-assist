"use client";

import { useState } from "react";
import BulkImportDialog from "./BulkImportDialog";
import PendingInvitations from "./PendingInvitations";

interface BulkImportSectionProps {
  organizationId: string;
}

export default function BulkImportSection({ organizationId }: BulkImportSectionProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleImportSuccess = () => {
    // Trigger refresh of pending invitations
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <div className="space-y-6">
      {/* Bulk Import Action */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Upload CSV/Excel files (or paste emails) to invite members in bulk.
          </p>
        </div>
        <BulkImportDialog
          organizationId={organizationId}
          onSuccess={handleImportSuccess}
        />
      </div>

      {/* Pending Invitations List */}
      <div className="pt-4 border-t">
        <h4 className="font-medium mb-4">Invitation History</h4>
        <PendingInvitations
          organizationId={organizationId}
          refreshKey={refreshKey}
        />
      </div>
    </div>
  );
}
