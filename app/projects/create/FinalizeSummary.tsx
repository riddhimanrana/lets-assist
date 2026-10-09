"use client";

import { format } from "date-fns";

import { RichTextContent } from "@/components/ui/rich-text-content";
import { getMultiDaySlotDisplayName } from "@/utils/project";

import { FormGroup } from "./form-parts";

export interface FinalizeState {
  eventType: string;
  verificationMethod: string;
  requireLogin: boolean;
  basicInfo: {
    title: string;
    location: string;
    description: string;
    organizationId: string | null;
  };
  schedule: {
    oneTime: {
      date: string;
      startTime: string;
      endTime: string;
      volunteers: number;
    };
    multiDay: {
      date: string;
      slots: {
        name: string;
        startTime: string;
        endTime: string;
        volunteers: number;
      }[];
    }[];
    sameDayMultiArea: {
      date: string;
      overallStart: string;
      overallEnd: string;
      roles: {
        name: string;
        startTime: string;
        endTime: string;
        volunteers: number;
      }[];
    };
  };
}

// Helper function to parse date string to Date object without timezone shifting
const parseStringToDate = (dateString: string): Date | undefined => {
  if (!dateString) return undefined;
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day); // month is 0-indexed in JavaScript Date
};

// Helper function to format date for display
const formatDateForDisplay = (dateString: string): string => {
  if (!dateString) return "Date not set";
  const date = parseStringToDate(dateString);
  return date ? format(date, "EEEE, MMMM d, yyyy") : "Date not set";
};

// Helper function to convert 24-hour time to 12-hour time with AM/PM
const convertTo12HourFormat = (time: string): string => {
  const [hour, minute] = time.split(":").map(Number);
  const period = hour >= 12 ? "PM" : "AM";
  const adjustedHour = hour % 12 || 12; // Convert 0 to 12 for 12 AM
  return `${adjustedHour}:${minute.toString().padStart(2, "0")} ${period}`;
};

// Format verification method for display
const getVerificationMethodDisplay = (method: string) => {
  switch (method) {
    case "qr-code":
      return {
        name: "QR code self check-in",
        description: "Volunteers will scan a QR code and log their own hours.",
      };
    case "auto":
      return {
        name: "Automatic check-in/out",
        description:
          "System will automatically log attendance for the full scheduled time.",
      };
    case "manual":
      return {
        name: "Manual check-in by organizer",
        description:
          "You will manually log each volunteer's attendance and hours.",
      };
    default:
      return {
        name: "Not specified",
        description: "",
      };
  }
};

const formatTimeRange = (startTime: string, endTime: string) =>
  `${convertTo12HourFormat(startTime)} - ${convertTo12HourFormat(endTime)}`;

const formatVolunteers = (volunteers: number) =>
  `${volunteers} volunteer${volunteers !== 1 ? "s" : ""} needed`;

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-6">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="grid min-w-0 gap-1 text-sm">{children}</dd>
    </div>
  );
}

/** A named block of the schedule: a slot or a role with its time and headcount. */
function ScheduleEntry({
  name,
  startTime,
  endTime,
  volunteers,
}: {
  name: string;
  startTime: string;
  endTime: string;
  volunteers: number;
}) {
  return (
    <li className="grid gap-0.5">
      <span className="font-medium">{name}</span>
      <span className="text-muted-foreground">
        {formatTimeRange(startTime, endTime)} · {formatVolunteers(volunteers)}
      </span>
    </li>
  );
}

/** A read-only recap of everything entered in the earlier steps. */
export function FinalizeSummary({ state }: { state: FinalizeState }) {
  const verificationMethod = getVerificationMethodDisplay(
    state.verificationMethod,
  );

  return (
    <FormGroup title="Summary">
      <div className="grid gap-1">
        <p className="text-lg font-semibold tracking-tight break-words">
          {state.basicInfo.title}
        </p>
        <p className="text-muted-foreground text-sm">
          {state.basicInfo.organizationId
            ? "Published as an organization account"
            : "Published as a personal project"}
        </p>
      </div>

      <dl className="divide-border divide-y border-y">
        <SummaryRow label="Location">
          <span className="break-words">{state.basicInfo.location}</span>
        </SummaryRow>

        <SummaryRow label="Description">
          <RichTextContent
            content={state.basicInfo.description}
            className="text-sm"
          />
        </SummaryRow>

        <SummaryRow label="Event type">
          <span>
            {state.eventType === "oneTime" && "Single event"}
            {state.eventType === "multiDay" && "Multiple day event"}
            {state.eventType === "sameDayMultiArea" && "Multi-role event"}
          </span>
        </SummaryRow>

        <SummaryRow label="Schedule">
          {state.eventType === "oneTime" && (
            <>
              <span>{formatDateForDisplay(state.schedule.oneTime.date)}</span>
              <span className="text-muted-foreground">
                {formatTimeRange(
                  state.schedule.oneTime.startTime,
                  state.schedule.oneTime.endTime,
                )}{" "}
                · {formatVolunteers(state.schedule.oneTime.volunteers)}
              </span>
            </>
          )}

          {state.eventType === "multiDay" && (
            <div className="grid gap-4">
              {state.schedule.multiDay.map((day, dayIndex) => (
                <div key={dayIndex} className="grid gap-2">
                  <span className="font-medium">
                    {formatDateForDisplay(day.date)}
                  </span>
                  <ul className="grid gap-2 border-l-2 pl-3">
                    {day.slots.map((slot, slotIndex) => (
                      <ScheduleEntry
                        key={slotIndex}
                        name={getMultiDaySlotDisplayName(slot, slotIndex)}
                        startTime={slot.startTime}
                        endTime={slot.endTime}
                        volunteers={slot.volunteers}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {state.eventType === "sameDayMultiArea" && (
            <div className="grid gap-2">
              <span>
                {formatDateForDisplay(state.schedule.sameDayMultiArea.date)}
              </span>
              <span className="text-muted-foreground">
                Overall hours:{" "}
                {formatTimeRange(
                  state.schedule.sameDayMultiArea.overallStart,
                  state.schedule.sameDayMultiArea.overallEnd,
                )}
              </span>
              <ul className="grid gap-2 border-l-2 pl-3">
                {state.schedule.sameDayMultiArea.roles.map(
                  (role, roleIndex) => (
                    <ScheduleEntry
                      key={roleIndex}
                      name={role.name || `Role ${roleIndex + 1}`}
                      startTime={role.startTime}
                      endTime={role.endTime}
                      volunteers={role.volunteers}
                    />
                  ),
                )}
              </ul>
            </div>
          )}
        </SummaryRow>

        <SummaryRow label="Verification method">
          <span>{verificationMethod.name}</span>
          {verificationMethod.description ? (
            <span className="text-muted-foreground">
              {verificationMethod.description}
            </span>
          ) : null}
        </SummaryRow>

        <SummaryRow label="Sign-up requirements">
          <span>
            {state.requireLogin
              ? "Account required"
              : "Anonymous sign-ups allowed"}
          </span>
          <span className="text-muted-foreground">
            {state.requireLogin
              ? "Volunteers must create an account to sign up for your event."
              : "Anyone can sign up without creating an account (anonymous volunteers)."}
          </span>
        </SummaryRow>
      </dl>
    </FormGroup>
  );
}
