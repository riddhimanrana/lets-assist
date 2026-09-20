"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  inspectAttendanceIntervals,
  localDateTime,
  localDateTimeCandidates,
  type AttendanceInterval,
} from "@/lib/projects/paper-signup/intervals";

export function AttendanceIntervalEditor({
  name,
  timezone,
  initialIntervals,
  window,
  correction,
  onClose,
  onSave,
}: {
  name: string;
  timezone: string;
  initialIntervals: AttendanceInterval[];
  window: { startsAt: number; endsAt: number } | null;
  correction: boolean;
  onClose: () => void;
  onSave: (intervals: AttendanceInterval[], reason: string) => Promise<boolean>;
}) {
  const [visits, setVisits] = useState(() =>
    initialIntervals.map((interval) => ({
      start: localDateTime(interval.checkIn, timezone),
      end: localDateTime(interval.checkOut, timezone),
      startChoice: interval.checkIn ?? "",
      endChoice: interval.checkOut ?? "",
    })),
  );
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const resolve = (value: string, choice: string) => {
    const choices = localDateTimeCandidates(value, timezone);
    return choices.length === 1
      ? choices[0]
      : choices.includes(choice)
        ? choice
        : null;
  };
  const intervals = visits.map((visit) => ({
    checkIn: resolve(visit.start, visit.startChoice),
    checkOut: resolve(visit.end, visit.endChoice),
  }));
  const inspection = inspectAttendanceIntervals(intervals, window);
  const reasonRequired = correction || inspection.outsideSession;
  const valid =
    reviewed &&
    !inspection.problems.length &&
    (!reasonRequired || reason.trim().length > 0);
  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      if (await onSave(intervals, reason.trim())) onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {correction ? "Correct published hours" : "Review attendance"}:{" "}
            {name}
          </DialogTitle>
          <DialogDescription>
            Use actual dates and times in {timezone}. Each visit excludes the
            break before the next visit.
          </DialogDescription>
        </DialogHeader>
        {visits.map((visit, index) => (
          <fieldset key={index} className="rounded border p-3 space-y-2">
            <legend className="px-1 text-sm">Visit {index + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["start", "end"] as const).map((field) => {
                const choices = localDateTimeCandidates(visit[field], timezone);
                const choiceKey =
                  field === "start" ? "startChoice" : "endChoice";
                return (
                  <div key={field} className="space-y-1">
                    <Label htmlFor={`hours-${index}-${field}`}>
                      {field === "start" ? "Sign in" : "Sign out"}
                    </Label>
                    <Input
                      id={`hours-${index}-${field}`}
                      type="datetime-local"
                      value={visit[field]}
                      onChange={(e) => {
                        setVisits(
                          visits.map((v, i) =>
                            i === index
                              ? {
                                  ...v,
                                  [field]: e.target.value,
                                  [choiceKey]: "",
                                }
                              : v,
                          ),
                        );
                        setReviewed(false);
                      }}
                    />
                    {choices.length > 1 && (
                      <select
                        aria-label={`Visit ${index + 1} ${field} clock occurrence`}
                        className="rounded border bg-background p-2 w-full"
                        value={visit[choiceKey]}
                        onChange={(e) => {
                          setVisits(
                            visits.map((v, i) =>
                              i === index
                                ? { ...v, [choiceKey]: e.target.value }
                                : v,
                            ),
                          );
                          setReviewed(false);
                        }}
                      >
                        <option value="">Choose clock occurrence</option>
                        {choices.map((choice) => (
                          <option key={choice} value={choice}>
                            {new Date(choice).toLocaleTimeString("en-US", {
                              timeZone: timezone,
                              timeZoneName: "shortOffset",
                            })}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setVisits(visits.filter((_, i) => i !== index));
                setReviewed(false);
              }}
            >
              Remove visit
            </Button>
          </fieldset>
        ))}
        <Button
          variant="outline"
          disabled={visits.length >= 20}
          onClick={() => {
            setVisits([
              ...visits,
              { start: "", end: "", startChoice: "", endChoice: "" },
            ]);
            setReviewed(false);
          }}
        >
          Add another visit
        </Button>
        <div className="text-sm space-y-1" aria-live="polite">
          {inspection.problems.map((problem) => (
            <p key={problem} className="text-destructive">
              {problem}
            </p>
          ))}
          {inspection.minutes !== null && (
            <p>
              Total: {Math.floor(inspection.minutes / 60)}h{" "}
              {inspection.minutes % 60}m
            </p>
          )}
          {inspection.outsideSession && (
            <p>
              These times extend beyond the scheduled session. Explain the
              exception.
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="hours-reason">
            {correction ? "Correction reason" : "Time exception reason"}
            {reasonRequired ? " (required)" : ""}
          </Label>
          <Input
            id="hours-reason"
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          I reviewed every visit, date, and time exception.
        </label>
        {correction && (
          <p className="text-sm text-muted-foreground">
            This updates the existing award and keeps a history of the previous
            values. It does not send an email.
          </p>
        )}
        <div className="flex gap-2">
          <Button disabled={!valid || busy} onClick={save}>
            {busy
              ? "Saving…"
              : correction
                ? "Save correction"
                : "Use reviewed times"}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
