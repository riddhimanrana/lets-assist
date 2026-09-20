"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHydrated } from "@/hooks/useHydrated";
import type {
  AttendancePrintSession,
  AttendancePrintSheet,
} from "@/lib/attendance/print-types";
import { createAttendancePrintSheets } from "./actions";
import { PrintableAttendanceSheets } from "./PrintableAttendanceSheets";
import "./print.css";

export function AttendanceSheetClient({
  projectId,
  projectTitle,
  timezone,
  sessions,
}: {
  projectId: string;
  projectTitle: string;
  timezone: string;
  sessions: AttendancePrintSession[];
}) {
  const hydrated = useHydrated();
  const [selected, setSelected] = useState<string[]>(
    sessions.length === 1 ? [sessions[0].id] : [],
  );
  const [blankRows, setBlankRows] = useState(10);
  const [continuationRows, setContinuationRows] = useState(4);
  const [paper, setPaper] = useState<"letter" | "a4">("letter");
  const [sheets, setSheets] = useState<AttendancePrintSheet[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  });

  async function prepare() {
    setBusy(true);
    setError(null);
    setSheets([]);
    try {
      const result = await createAttendancePrintSheets({
        projectId,
        scheduleIds: selected,
        blankRows,
        continuationRows,
      });
      if ("error" in result) setError(result.error);
      else setSheets(result.sheets);
    } catch {
      setError("Could not prepare the sheets. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function changeOptions(change: () => void) {
    change();
    setSheets([]);
  }

  return (
    <main
      className={`attendance-sheet-root attendance-paper-${paper}`}
      data-hydrated={hydrated}
    >
      <style>{`@page { size: ${paper === "a4" ? "A4" : "letter"} portrait; margin: 12mm; }`}</style>
      <div className="attendance-print-controls mx-auto max-w-4xl space-y-6 px-4 py-8">
        <Link
          href={`/projects/${projectId}/signups`}
          className="text-sm underline"
        >
          Back to signups
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">Print attendance sheets</h1>
          <p className="text-muted-foreground">{projectTitle}</p>
        </div>
        <p>
          Registered volunteers appear by name only. Blank rows let walk-ins
          write their name and email. Each row has space for two visits.
        </p>
        <fieldset
          disabled={busy || !hydrated}
          className="space-y-3 rounded-lg border p-4"
        >
          <legend className="px-1 font-medium">Sessions</legend>
          {sessions.length === 0 && <p>No printable sessions are available.</p>}
          {sessions.map((session) => (
            <label key={session.id} className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={selected.includes(session.id)}
                onChange={(event) =>
                  changeOptions(() =>
                    setSelected(
                      event.target.checked
                        ? [...selected, session.id]
                        : selected.filter((id) => id !== session.id),
                    ),
                  )
                }
              />
              <span>
                <span className="block font-medium">{session.label}</span>
                <span className="text-sm text-muted-foreground">
                  {date.format(session.startsAt)} · {timezone}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-2">
            Walk-in rows per session
            <Input
              type="number"
              min={0}
              max={100}
              value={blankRows}
              disabled={busy || !hydrated}
              onChange={(event) =>
                changeOptions(() => setBlankRows(event.target.valueAsNumber))
              }
            />
          </label>
          <label className="space-y-2">
            Continuation rows per session
            <Input
              type="number"
              min={0}
              max={30}
              value={continuationRows}
              disabled={busy || !hydrated}
              onChange={(event) =>
                changeOptions(() =>
                  setContinuationRows(event.target.valueAsNumber),
                )
              }
            />
          </label>
          <label className="space-y-2">
            Paper size
            <select
              className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={paper}
              disabled={busy || !hydrated}
              onChange={(event) =>
                setPaper(event.target.value as "letter" | "a4")
              }
            >
              <option value="letter">US Letter</option>
              <option value="a4">A4</option>
            </select>
          </label>
        </div>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={prepare}
            disabled={!hydrated || busy || selected.length === 0}
          >
            {busy ? "Preparing sheets..." : "Prepare sheets"}
          </Button>
          {sheets.length > 0 && (
            <Button variant="outline" onClick={() => window.print()}>
              Print / Save PDF
            </Button>
          )}
        </div>
        {sheets.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Check the preview below, then print or choose Save as PDF. Use{" "}
            {paper === "letter" ? "US Letter" : "A4"}, portrait, 100% scale, and
            turn off browser headers and footers.
          </p>
        )}
      </div>
      <PrintableAttendanceSheets sheets={sheets} />
    </main>
  );
}
