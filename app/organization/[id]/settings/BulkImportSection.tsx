"use client";

import { useState } from "react";

import { SettingsSection } from "@/components/layout/SettingsSection";

import BulkImportDialog from "./BulkImportDialog";
import PendingInvitations from "./PendingInvitations";

interface BulkImportSectionProps {
  organizationId: string;
}

export default function BulkImportSection({
  organizationId,
}: BulkImportSectionProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleImportSuccess = () => {
    // Trigger refresh of pending invitations
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <>
      <SettingsSection
        title="Bulk import"
        description="Invite many members or staff at once by email."
        footerHint="Upload a CSV or Excel file, or paste a list of emails."
        footer={
          <BulkImportDialog
            organizationId={organizationId}
            onSuccess={handleImportSuccess}
          />
        }
      />

      <SettingsSection
        title="Invitation history"
        description="Email invitations sent for this organization and where each one stands."
      >
        <PendingInvitations
          organizationId={organizationId}
          refreshKey={refreshKey}
        />
      </SettingsSection>
    </>
  );
}
