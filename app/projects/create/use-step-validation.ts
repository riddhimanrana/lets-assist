"use client";

import { useState } from "react";
import { z } from "zod";

import type { useEventForm } from "@/hooks/use-event-form";
import {
  DUPLICATE_ROLE_NAME_MESSAGE,
  basicInfoSchema,
  createMultiDaySchema,
  createMultiRoleSchema,
  createOneTimeSchema,
  verificationSettingsSchema,
} from "@/schemas/event-form-schema";

import { getRecurrenceStepErrors, getWaiverStepError } from "./create-blockers";

type EventForm = ReturnType<typeof useEventForm>;

/**
 * Per-step validation for the create flow, plus the field updaters that clear
 * a field's error as soon as it is edited. Every rule here is also enforced by
 * the create action, so a step that passes is a step the server accepts.
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
  // Repeat and waiver problems are recomputed from the form once their step
  // has been checked, so a message leaves as soon as its cause is fixed.
  const [recurrenceChecked, setRecurrenceChecked] = useState(false);
  const [waiverChecked, setWaiverChecked] = useState(false);

  const recurrenceErrors = recurrenceChecked
    ? getRecurrenceStepErrors(state)
    : {};
  const waiverError = waiverChecked
    ? (getWaiverStepError(state) ?? undefined)
    : undefined;

  // Times are judged in the project's timezone, as the server judges them.
  const scheduleIssues = (): z.ZodIssue[] => {
    const options = { timeZone: state.basicInfo.projectTimezone };
    const result =
      state.eventType === "oneTime"
        ? createOneTimeSchema(options).safeParse(state.schedule.oneTime)
        : state.eventType === "multiDay"
          ? createMultiDaySchema(options).safeParse(state.schedule.multiDay)
          : createMultiRoleSchema(options).safeParse(
              state.schedule.sameDayMultiArea,
            );
    return result.success ? [] : result.error.issues;
  };

  const verificationIssues = (): z.ZodIssue[] => {
    const result = verificationSettingsSchema.safeParse({
      verificationMethod: state.verificationMethod,
      requireLogin: state.requireLogin,
      visibility: state.visibility,
      enableVolunteerComments: state.enableVolunteerComments,
      showAttendeesPublicly: state.showAttendeesPublicly,
      waiverRequired: state.waiverRequired,
      waiverAllowUpload: state.waiverAllowUpload,
      waiverDisableEsignature: state.waiverDisableEsignature,
    });
    return result.success ? [] : result.error.issues;
  };

  const validateSchedule = (): boolean => {
    const issues = scheduleIssues();
    const recurrenceValid =
      Object.keys(getRecurrenceStepErrors(state)).length === 0;
    setScheduleErrors(issues);
    setRecurrenceChecked(!recurrenceValid);
    return issues.length === 0 && recurrenceValid;
  };

  const validateSettings = (): boolean => {
    const issues = verificationIssues();
    const waiverValid = getWaiverStepError(state) === null;
    setVerificationErrors(issues);
    setWaiverChecked(!waiverValid);
    return issues.length === 0 && waiverValid;
  };

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
          // Renaming one role can resolve the clash on another.
          if (
            field === "name" &&
            error.message === DUPLICATE_ROLE_NAME_MESSAGE
          ) {
            return false;
          }
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

  // Validate the current step. Returns whether the form may move on.
  const validateCurrentStep = (): boolean => {
    let valid: boolean;

    switch (state.step) {
      case 1: {
        const result = basicInfoSchema.safeParse(state.basicInfo);
        setBasicInfoErrors(result.success ? [] : result.error.issues);
        valid = result.success;
        break;
      }
      case 2: // Event type: any choice is valid.
        return true;
      case 3:
        valid = validateSchedule();
        break;
      case 4:
        valid = validateSettings();
        break;
      default:
        // Organization plugin steps and the final step have nothing to
        // validate here. Returning false for a plugin step used to leave its
        // Continue button doing nothing.
        return state.step <= finalStep;
    }

    // Mark validation as attempted so errors will show
    if (!valid) setValidationAttempted(true);
    return valid;
  };

  /** Every step at once, before the project is submitted. */
  const validateAllSteps = (): boolean => {
    const basicInfo = basicInfoSchema.safeParse(state.basicInfo);
    setBasicInfoErrors(basicInfo.success ? [] : basicInfo.error.issues);
    const scheduleValid = validateSchedule();
    const settingsValid = validateSettings();

    const valid = basicInfo.success && scheduleValid && settingsValid;
    if (!valid) setValidationAttempted(true);
    return valid;
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
    validateAllSteps,
    getFieldError,
    recurrenceErrors,
    waiverError,
  };
}
