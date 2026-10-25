"use client";

import { SparklesIcon, useAnimatedIcon } from "@/components/icons/animated";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";

import DraftsSidebar, { type Draft } from "./DraftsSidebar";

/** The page title with the flow's two secondary actions: AI auto-fill and drafts. */
export function CreateHeader({
  drafts,
  showAIButton,
  isAIAssistantOpen,
  onToggleAIAssistant,
  onSaveDraft,
  isSavingDraft,
  saveDraftDisabled,
  saveDraftBlockedReason,
}: {
  drafts: Draft[];
  showAIButton: boolean;
  isAIAssistantOpen: boolean;
  onToggleAIAssistant: () => void;
  onSaveDraft: () => void;
  isSavingDraft: boolean;
  saveDraftDisabled: boolean;
  saveDraftBlockedReason?: string;
}) {
  const aiIcon = useAnimatedIcon();

  return (
    <PageHeader
      title={
        // The shared header truncates its title; this one is long enough to
        // need a second line on a phone.
        <span className="block whitespace-normal">
          Create a volunteering project
        </span>
      }
      actions={
        <>
          {showAIButton && (
            <Button
              variant="outline"
              aria-expanded={isAIAssistantOpen}
              onClick={onToggleAIAssistant}
              {...aiIcon.triggerProps}
            >
              <SparklesIcon
                ref={aiIcon.ref}
                size={16}
                data-icon="inline-start"
                aria-hidden="true"
              />
              AI auto-fill
            </Button>
          )}
          <DraftsSidebar
            initialDrafts={drafts}
            onSaveDraft={onSaveDraft}
            isSavingDraft={isSavingDraft}
            saveDraftDisabled={saveDraftDisabled}
            saveDraftBlockedReason={saveDraftBlockedReason}
          />
        </>
      }
    />
  );
}
