"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  inspectAttendanceIntervals,
  localDateTime,
  localDateTimeCandidates,
} from "@/lib/projects/paper-signup/intervals";
import { updatePaperScanRow } from "./actions";
import { loadAttendanceCandidates } from "./manual-actions";
import type { PaperScanRowView } from "./PaperSignupsClient";

interface Props {
  projectId: string;
  batchId: string;
  row: PaperScanRowView;
  timezone: string;
  window: { startsAt: number; endsAt: number } | null;
  sourceUrl?: string;
  onClose: () => void;
  onSaved: (row: PaperScanRowView) => void;
}

export function ReviewRowEditor({
  projectId,
  batchId,
  row,
  timezone,
  window,
  sourceUrl,
  onClose,
  onSaved,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [candidates, setCandidates] = useState<
    Array<{ id: string; name: string; email: string | null }>
  >([]);
  const [form, setForm] = useState({
    name: row.name ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    matchSignupId: row.matchSignupId ?? "",
    signaturePresent: row.signaturePresent,
    identityConfirmed: row.identityConfirmed,
    reviewAcknowledged: row.reviewAcknowledged,
    reason: row.timeExceptionReason ?? "",
  });
  const [visits, setVisits] = useState(() =>
    row.attendanceIntervals.map((interval) => ({
      start: localDateTime(interval.checkIn, timezone),
      end: localDateTime(interval.checkOut, timezone),
      startChoice: interval.checkIn ?? "",
      endChoice: interval.checkOut ?? "",
    })),
  );
  useEffect(() => {
    let current = true;
    void loadAttendanceCandidates({ projectId, batchId }).then((result) => {
      if (current && "candidates" in result)
        setCandidates(result.candidates ?? []);
    });
    return () => {
      current = false;
    };
  }, [projectId, batchId]);
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
  const patchVisit = (index: number, patch: Partial<(typeof visits)[number]>) =>
    setVisits((current) =>
      current.map((visit, i) => (i === index ? { ...visit, ...patch } : visit)),
    );
  const save = async () => {
    if (
      form.reviewAcknowledged &&
      (inspection.problems.length ||
        (inspection.outsideSession && !form.reason.trim()))
    ) {
      toast.error(
        "Resolve the time warnings before marking this row reviewed.",
      );
      return;
    }
    setSaving(true);
    try {
      const patch = {
        name: form.name.trim() || null,
        email: form.email.trim().toLowerCase() || null,
        phone: form.phone.trim() || null,
        matchSignupId: form.matchSignupId || null,
        signaturePresent: form.signaturePresent,
        attendanceIntervals: intervals,
        checkInTime: intervals[0]?.checkIn ?? null,
        checkOutTime: intervals.at(-1)?.checkOut ?? null,
        reviewAcknowledged: form.reviewAcknowledged,
        identityConfirmed: form.identityConfirmed,
        timeExceptionReason: form.reason.trim() || null,
        expectedRevision: row.reviewRevision,
      };
      const result = await updatePaperScanRow({
        projectId,
        batchId,
        rowId: row.id,
        patch,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      onSaved({
        ...row,
        ...patch,
        outcome: "pending",
        outcomeDetail: null,
        reviewRevision: row.reviewRevision + 1,
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review row {row.sheetRowNumber}</DialogTitle>
          <DialogDescription>
            Check the volunteer and every visit. Dates and times use {timezone}.
          </DialogDescription>
        </DialogHeader>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="block"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sourceUrl}
              alt={`Source sheet for row ${row.sheetRowNumber}`}
              className="max-h-72 w-full rounded border object-contain"
            />
            <span className="text-sm underline">
              Open full-size source photo
            </span>
          </a>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="attendance-name">Name</Label>
            <Input
              id="attendance-name"
              value={form.name}
              onChange={(e) =>
                setForm({
                  ...form,
                  name: e.target.value,
                  matchSignupId: "",
                  identityConfirmed: false,
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="attendance-email">Email</Label>
            <Input
              id="attendance-email"
              type="email"
              value={form.email}
              onChange={(e) =>
                setForm({
                  ...form,
                  email: e.target.value,
                  matchSignupId: "",
                  identityConfirmed: false,
                })
              }
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="attendance-phone">Phone (optional)</Label>
          <Input
            id="attendance-phone"
            type="tel"
            value={form.phone}
            onChange={(e) =>
              setForm({
                ...form,
                phone: e.target.value,
                reviewAcknowledged: false,
              })
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="attendance-match">
            Existing signup, if this person already signed up
          </Label>
          <select
            id="attendance-match"
            className="w-full rounded border bg-background p-2"
            value={form.matchSignupId}
            onChange={(e) =>
              setForm({
                ...form,
                matchSignupId: e.target.value,
                identityConfirmed: false,
              })
            }
          >
            <option value="">
              Use reviewed email, or keep as an uncredited roster entry
            </option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
                {candidate.email ? ` (${candidate.email})` : ""}
              </option>
            ))}
          </select>
          <p className="text-sm text-muted-foreground">
            A known signup does not need an email copied from the sheet. Other
            rows need an email before they can receive hours.
          </p>
        </div>
        <fieldset className="space-y-3">
          <legend className="font-medium">Visits and breaks</legend>
          {visits.map((visit, index) => (
            <div key={index} className="rounded border p-3 space-y-2">
              <div className="flex justify-between">
                <span>Visit {index + 1}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setVisits(visits.filter((_, i) => i !== index));
                    setForm({ ...form, reviewAcknowledged: false });
                  }}
                >
                  Remove visit
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["start", "end"] as const).map((field) => {
                  const choices = localDateTimeCandidates(
                    visit[field],
                    timezone,
                  );
                  const choiceKey =
                    field === "start" ? "startChoice" : "endChoice";
                  return (
                    <div key={field} className="space-y-1">
                      <Label htmlFor={`visit-${index}-${field}`}>
                        {field === "start" ? "Sign in" : "Sign out"}
                      </Label>
                      <Input
                        id={`visit-${index}-${field}`}
                        type="datetime-local"
                        value={visit[field]}
                        onChange={(e) => {
                          patchVisit(index, {
                            [field]: e.target.value,
                            [choiceKey]: "",
                          });
                          setForm({ ...form, reviewAcknowledged: false });
                        }}
                      />
                      {visit[field] && choices.length === 0 && (
                        <p className="text-sm text-destructive">
                          This local time does not exist. Check the date and
                          daylight-saving change.
                        </p>
                      )}
                      {choices.length > 1 && (
                        <select
                          aria-label={`Visit ${index + 1} ${field} clock occurrence`}
                          className="w-full rounded border bg-background p-2"
                          value={visit[choiceKey]}
                          onChange={(e) => {
                            patchVisit(index, { [choiceKey]: e.target.value });
                            setForm({ ...form, reviewAcknowledged: false });
                          }}
                        >
                          <option value="">
                            Choose which clock occurrence
                          </option>
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
            </div>
          ))}
          <Button
            variant="outline"
            disabled={visits.length >= 20}
            onClick={() => {
              setVisits([
                ...visits,
                { start: "", end: "", startChoice: "", endChoice: "" },
              ]);
              setForm({ ...form, reviewAcknowledged: false });
            }}
          >
            Add another visit
          </Button>
        </fieldset>
        <div aria-live="polite" className="rounded bg-muted p-3 text-sm">
          {inspection.minutes !== null && (
            <p>
              Total: {Math.floor(inspection.minutes / 60)}h{" "}
              {inspection.minutes % 60}m, excluding breaks.
            </p>
          )}
          {inspection.problems.map((problem) => (
            <p key={problem} className="text-destructive">
              {problem}
            </p>
          ))}
          {inspection.outsideSession && (
            <p>
              Actual times extend outside the scheduled session. Record why
              below.
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="attendance-reason">Reason for time exceptions</Label>
          <Input
            id="attendance-reason"
            value={form.reason}
            onChange={(e) =>
              setForm({
                ...form,
                reason: e.target.value,
                reviewAcknowledged: false,
              })
            }
          />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            id="attendance-signature"
            type="checkbox"
            checked={form.signaturePresent}
            onChange={(e) =>
              setForm({
                ...form,
                signaturePresent: e.target.checked,
                reviewAcknowledged: false,
              })
            }
          />
          Signature visible on the sheet
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            id="attendance-identity-confirmed"
            type="checkbox"
            checked={form.identityConfirmed}
            onChange={(e) =>
              setForm({ ...form, identityConfirmed: e.target.checked })
            }
          />
          I checked this volunteer's identity and selected the correct signup or
          email.
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            id="attendance-review-acknowledged"
            type="checkbox"
            checked={form.reviewAcknowledged}
            onChange={(e) =>
              setForm({ ...form, reviewAcknowledged: e.target.checked })
            }
          />
          I reviewed all times and dates, including any overnight visit or
          exception.
        </label>
        <div className="flex gap-2">
          <Button disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save review"}
          </Button>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
