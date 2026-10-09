"use client";

import { AlertTriangle } from "lucide-react";
import type { ZodIssue } from "zod";

import { PlusIcon, useAnimatedIcon } from "@/components/icons/animated";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DUPLICATE_ROLE_NAME_MESSAGE } from "@/schemas/event-form-schema";
import { TimePicker } from "@/components/ui/time-picker";

import { FormField, FormGroup } from "./form-parts";
import {
  DateField,
  NameField,
  RemoveButton,
  TimeField,
  VolunteersField,
  getArrayError,
  getFieldError,
  isTimeInPast,
  isTimeRangeInvalid,
  type ScheduleState,
} from "./schedule-shared";

export function ScheduleMultiRole({
  sameDayMultiArea,
  updateMultiRoleScheduleAction,
  addRoleAction,
  removeRoleAction,
  errors,
  timeZone,
}: {
  sameDayMultiArea: ScheduleState["schedule"]["sameDayMultiArea"];
  updateMultiRoleScheduleAction: (
    field: string,
    value: string | number,
    roleIndex?: number,
  ) => void;
  addRoleAction: () => void;
  removeRoleAction: (roleIndex: number) => void;
  errors: ZodIssue[];
  /** The project's timezone, which decides whether a time has passed. */
  timeZone?: string;
}) {
  const addRoleIcon = useAnimatedIcon();

  // Problems that belong to the role list as a whole, plus one line for
  // repeated names so the reason is visible without scrolling to the field.
  const roleListMessages = [
    ...new Set(
      errors
        .filter(
          (issue) =>
            issue.path[0] === "roles" &&
            (issue.path.length === 1 ||
              issue.path[1] === "roles" ||
              issue.message === DUPLICATE_ROLE_NAME_MESSAGE),
        )
        .map((issue) =>
          issue.message === DUPLICATE_ROLE_NAME_MESSAGE
            ? "Two or more roles share a name. Give each role a different name."
            : issue.message,
        ),
    ),
  ];

  // Get errors for sameDayMultiArea fields
  const dateError = getFieldError(errors, "date");
  const overallStartError = getFieldError(errors, "overallStart");
  const overallEndError = getFieldError(errors, "overallEnd");

  return (
    <>
      <FormGroup title="Date and hours">
        <div className="grid gap-5 sm:grid-cols-2">
          <DateField
            id="multi-role-date"
            label="Event date"
            value={sameDayMultiArea.date}
            onChange={(date) => updateMultiRoleScheduleAction("date", date)}
            error={dateError}
          />
          <FormField
            label="Overall event hours (auto-calculated)"
            description="Overall times auto-adjust by earliest/latest role times."
          >
            <div className="grid grid-cols-2 gap-2">
              <TimePicker
                value={sameDayMultiArea.overallStart}
                onChangeAction={(time: string) =>
                  updateMultiRoleScheduleAction("overallStart", time)
                }
                error={!!overallStartError}
                errorMessage={overallStartError}
                disabled={true}
              />
              <TimePicker
                value={sameDayMultiArea.overallEnd}
                onChangeAction={(time: string) =>
                  updateMultiRoleScheduleAction("overallEnd", time)
                }
                error={!!overallEndError}
                errorMessage={overallEndError}
                disabled={true}
              />
            </div>
          </FormField>
        </div>
      </FormGroup>

      {roleListMessages.length > 0 ? (
        <FormGroup>
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertDescription>
              {roleListMessages.length === 1 ? (
                roleListMessages[0]
              ) : (
                <ul className="list-inside list-disc">
                  {roleListMessages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        </FormGroup>
      ) : null}

      {sameDayMultiArea.roles.map((role, roleIndex) => {
        const roleTimeInvalid = isTimeRangeInvalid(
          role.startTime,
          role.endTime,
        );

        // Get role-specific errors
        const nameError = getArrayError(errors, "roles", roleIndex, "name");
        const startTimeError = getArrayError(
          errors,
          "roles",
          roleIndex,
          "startTime",
        );
        const endTimeError = getArrayError(
          errors,
          "roles",
          roleIndex,
          "endTime",
        );
        const volunteersError = getArrayError(
          errors,
          "roles",
          roleIndex,
          "volunteers",
        );
        const startInPast = isTimeInPast(
          sameDayMultiArea.date,
          role.startTime,
          timeZone,
        );
        const endInPast = isTimeInPast(
          sameDayMultiArea.date,
          role.endTime,
          timeZone,
        );

        return (
          <FormGroup
            key={roleIndex}
            title={`Role ${roleIndex + 1}`}
            aside={
              roleIndex > 0 ? (
                <RemoveButton
                  label={`Remove role ${roleIndex + 1}`}
                  onClick={() => removeRoleAction(roleIndex)}
                />
              ) : null
            }
          >
            <NameField
              id={`multi-role-${roleIndex}-name`}
              label="Role name"
              placeholder="Role name (e.g., Event Decoration)"
              value={role.name}
              onChange={(value) =>
                updateMultiRoleScheduleAction("name", value, roleIndex)
              }
              error={nameError}
            />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <TimeField
                label="Start time"
                value={role.startTime}
                onChange={(time) =>
                  updateMultiRoleScheduleAction("startTime", time, roleIndex)
                }
                error={roleTimeInvalid || startInPast || !!startTimeError}
                errorMessage={
                  startTimeError
                    ? startTimeError
                    : roleTimeInvalid
                      ? "Invalid time"
                      : startInPast
                        ? "Start time must be in the future"
                        : undefined
                }
              />
              <TimeField
                label="End time"
                value={role.endTime}
                onChange={(time) =>
                  updateMultiRoleScheduleAction("endTime", time, roleIndex)
                }
                error={roleTimeInvalid || endInPast || !!endTimeError}
                errorMessage={
                  endTimeError
                    ? endTimeError
                    : roleTimeInvalid
                      ? "Invalid time"
                      : endInPast
                        ? "End time must be in the future"
                        : undefined
                }
              />
              <div className="col-span-2 sm:col-span-1">
                <VolunteersField
                  id={`multi-role-${roleIndex}-volunteers`}
                  label="Volunteers needed"
                  placeholder="Enter number of volunteers"
                  value={role.volunteers}
                  onChange={(value) =>
                    updateMultiRoleScheduleAction(
                      "volunteers",
                      value,
                      roleIndex,
                    )
                  }
                  error={volunteersError}
                />
              </div>
            </div>
          </FormGroup>
        );
      })}

      <FormGroup>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={addRoleAction}
          {...addRoleIcon.triggerProps}
        >
          <PlusIcon
            ref={addRoleIcon.ref}
            size={16}
            data-icon="inline-start"
            aria-hidden="true"
          />
          Add another role
        </Button>
      </FormGroup>
    </>
  );
}
