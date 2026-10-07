"use client";

import { useState } from "react";
import { z } from "zod";

import type { useEventForm } from "@/hooks/use-event-form";
import {
  basicInfoSchema,
  oneTimeSchema,
  multiDaySchema,
  multiRoleSchema,
  verificationSettingsSchema,
} from "@/schemas/event-form-schema";

type EventForm = ReturnType<typeof useEventForm>;

/**
 * Per-step Zod validation for the create flow, plus the field updaters that
 * clear a field's error as soon as it is edited. Moved out of ProjectCreator
 * unchanged.
 */
export function useStepValidation({
  state,
  finalStep,
  updateBasicInfo,
  updateOneTimeSchedule,
  updateMultiDaySchedule,
  updateMultiRoleSchedule,
}: {
  state: EventForm["state"];
  finalStep: number;
  updateBasicInfo: EventForm["updateBasicInfo"];
  updateOneTimeSchedule: EventForm["updateOneTimeSchedule"];
  updateMultiDaySchedule: EventForm["updateMultiDaySchedule"];
  updateMultiRoleSchedule: EventForm["updateMultiRoleSchedule"];
}) {
  // Form validation states
  const [basicInfoErrors, setBasicInfoErrors] = useState<z.ZodIssue[]>([]);
  const [scheduleErrors, setScheduleErrors] = useState<z.ZodIssue[]>([]);
  const [verificationErrors, setVerificationErrors] = useState<z.ZodIssue[]>(
    [],
  );

  // Validation tracking - only validate after continue is clicked
  const [validationAttempted, setValidationAttempted] = useState(false);

  // Clear errors when a field is updated
  const handleBasicInfoUpdate = (
    field: Parameters<typeof updateBasicInfo>[0],
    value: Parameters<typeof updateBasicInfo>[1],
  ) => {
    // Clear errors related to this field
    if (validationAttempted) {
      setBasicInfoErrors((prev) =>
        prev.filter((error) => !error.path.includes(field)),
      );
    }
    updateBasicInfo(field, value);
  };

  const handleOneTimeScheduleUpdate = (
    field: Parameters<typeof updateOneTimeSchedule>[0],
    value: Parameters<typeof updateOneTimeSchedule>[1],
  ) => {
    // Clear errors related to this field
    if (validationAttempted) {
      setScheduleErrors((prev) =>
        prev.filter((error) => !error.path.includes(field)),
      );
    }
    updateOneTimeSchedule(field, value);
  };

  const handleMultiDayScheduleUpdate = (
    dayIndex: number,
    field: Parameters<typeof updateMultiDaySchedule>[1],
    value: Parameters<typeof updateMultiDaySchedule>[2],
    slotIndex?: number,
  ) => {
    // Clear errors related to this field/slot
    if (validationAttempted) {
      setScheduleErrors((prev) =>
        prev.filter((error) => {
          if (slotIndex !== undefined) {
            return !(
              error.path[0] === dayIndex &&
              error.path[2] === slotIndex &&
              error.path.includes(field)
            );
          }
          return !(error.path[0] === dayIndex && error.path.includes(field));
        }),
      );
    }
    updateMultiDaySchedule(dayIndex, field, value, slotIndex);
  };

  const handleMultiRoleScheduleUpdate = (
    field: Parameters<typeof updateMultiRoleSchedule>[0],
    value: Parameters<typeof updateMultiRoleSchedule>[1],
    roleIndex?: number,
  ) => {
    // Clear errors related to this field/role
    if (validationAttempted) {
      setScheduleErrors((prev) =>
        prev.filter((error) => {
          if (roleIndex !== undefined) {
            return !(
              error.path[0] === "roles" &&
              error.path[1] === roleIndex &&
              error.path.includes(field)
            );
          }
          return !error.path.includes(field);
        }),
      );
    }
    updateMultiRoleSchedule(field, value, roleIndex);
  };

  // Validate current step with Zod
  const validateCurrentStep = (): boolean => {
    try {
      switch (state.step) {
        case 1: // Basic Info
          basicInfoSchema.parse(state.basicInfo);
          setBasicInfoErrors([]);
          return true;

        case 2: // Event Type
          // No validation needed for event type selection
          return true;

        case 3: // Schedule
          if (state.eventType === "oneTime") {
            oneTimeSchema.parse(state.schedule.oneTime);
          } else if (state.eventType === "multiDay") {
            multiDaySchema.parse(state.schedule.multiDay);
          } else if (state.eventType === "sameDayMultiArea") {
            multiRoleSchema.parse(state.schedule.sameDayMultiArea);
          }
          setScheduleErrors([]);
          return true;

        case 4: // Verification Settings
          verificationSettingsSchema.parse({
            verificationMethod: state.verificationMethod,
            requireLogin: state.requireLogin,
            visibility: state.visibility,
            waiverRequired: state.waiverRequired,
            waiverAllowUpload: state.waiverAllowUpload,
            waiverDisableEsignature: state.waiverDisableEsignature,
          });
          setVerificationErrors([]);
          return true;

        default:
          if (state.step === finalStep) {
            // No validation needed for files
            return true;
          }
          return false;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Store errors according to the current step
        switch (state.step) {
          case 1:
            setBasicInfoErrors(error.issues);
            break;
          case 3:
            setScheduleErrors(error.issues);
            break;
          case 4:
            setVerificationErrors(error.issues);
            break;
        }
        // Mark validation as attempted so errors will show
        setValidationAttempted(true);
      }
      return false;
    }
  };

  // Get field error from Zod issues
  const getFieldError = (
    fieldPath: string,
    issues: z.ZodIssue[],
  ): string | undefined => {
    if (!validationAttempted) return undefined;

    const error = issues.find((issue) => {
      // Match exact field or field in array (e.g., "roles.0.name")
      return (
        issue.path.join(".") === fieldPath ||
        issue.path.join(".").startsWith(fieldPath + "[") ||
        issue.path.join(".").startsWith(fieldPath + ".")
      );
    });
    return error?.message;
  };

  return {
    basicInfoErrors,
    scheduleErrors,
    verificationErrors,
    setVerificationErrors,
    validationAttempted,
    setValidationAttempted,
    handleBasicInfoUpdate,
    handleOneTimeScheduleUpdate,
    handleMultiDayScheduleUpdate,
    handleMultiRoleScheduleUpdate,
    validateCurrentStep,
    getFieldError,
  };
}
