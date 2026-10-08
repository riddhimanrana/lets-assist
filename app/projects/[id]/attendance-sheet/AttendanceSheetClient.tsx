"use client";

import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsSection } from "@/components/layout/SettingsSection";
import { ProjectToolBreadcrumb } from "../ProjectToolBreadcrumb";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
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
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  const zone =
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value ?? timezone;

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const result = await createAttendancePrintSheets({
        projectId,
        requestId,
        scheduleIds: selected,
        blankRows,
        continuationRows,
      });
      if ("error" in result) setError(result.error);
      else {
        setSheets(result.sheets);
        setRequestId(crypto.randomUUID());
      }
    } catch {
      setError("Could not prepare the sheets. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function changeOptions(change: () => void) {
    change();
    setSheets([]);
    setError(null);
    setRequestId(crypto.randomUUID());
  }

  return (
    <main
      className={`attendance-sheet-root attendance-paper-${paper}`}
      data-hydrated={hydrated}
    >
      <style>{`@page { size: ${paper === "a4" ? "A4" : "letter"} portrait; margin: 12mm; }`}</style>
      <div className="attendance-print-controls mx-auto grid max-w-4xl gap-6 px-4 py-6 sm:px-6">
        <PageHeader
          breadcrumb={
            <ProjectToolBreadcrumb
              projectId={projectId}
              projectTitle={projectTitle}
              current="Print attendance sheets"
            />
          }
          title="Print attendance sheets"
          description="Registered volunteers appear by name only. Blank rows let walk-ins write their name and email. Each row has space for two visits."
        />
        <SettingsSection
          title="Sheet setup"
          description="Choose the sessions to print and how much room to leave for walk-ins."
          footerHint={
            sheets.length > 0
              ? `Check the preview below, then print or choose Save as PDF. Use ${paper === "letter" ? "US Letter" : "A4"}, portrait, 100% scale, and turn off browser headers and footers.`
              : "Preparing sheets shows a preview. Nothing prints until you choose to."
          }
          footer={
            <>
              {sheets.length > 0 && (
                <Button variant="outline" onClick={() => window.print()}>
                  Print / Save PDF
                </Button>
              )}
              <Button
                onClick={prepare}
                disabled={!hydrated || busy || selected.length === 0}
              >
                {busy
                  ? "Preparing sheets..."
                  : error
                    ? "Retry preparation"
                    : "Prepare sheets"}
              </Button>
            </>
          }
        >
          <FieldGroup>
            <FieldSet disabled={busy || !hydrated}>
              <FieldLegend variant="label">Sessions</FieldLegend>
              {sessions.length === 0 ? (
                <FieldDescription>
                  No printable sessions are available.
                </FieldDescription>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {sessions.map((session) => {
                    const checkboxId = `print-session-${session.id}`;
                    return (
                      <FieldLabel key={session.id} htmlFor={checkboxId}>
                        <Field orientation="horizontal">
                          <Checkbox
                            id={checkboxId}
                            checked={selected.includes(session.id)}
                            onCheckedChange={(checked) =>
                              changeOptions(() =>
                                setSelected(
                                  checked
                                    ? [...selected, session.id]
                                    : selected.filter(
                                        (id) => id !== session.id,
                                      ),
                                ),
                              )
                            }
                          />
                          <FieldContent>
                            <FieldTitle>{session.label}</FieldTitle>
                            <FieldDescription>
                              {date.format(session.startsAt)} {zone}
                            </FieldDescription>
                          </FieldContent>
                        </Field>
                      </FieldLabel>
                    );
                  })}
                </div>
              )}
            </FieldSet>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="print-walk-in-rows">
                  Walk-in rows per session
                </FieldLabel>
                <Input
                  id="print-walk-in-rows"
                  type="number"
                  min={0}
                  max={100}
                  value={blankRows}
                  disabled={busy || !hydrated}
                  onChange={(event) =>
                    changeOptions(() =>
                      setBlankRows(event.target.valueAsNumber),
                    )
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="print-continuation-rows">
                  Continuation rows per session
                </FieldLabel>
                <Input
                  id="print-continuation-rows"
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
              </Field>
              <Field>
                <FieldLabel htmlFor="print-paper-size">Paper size</FieldLabel>
                <NativeSelect
                  id="print-paper-size"
                  className="w-full"
                  value={paper}
                  disabled={busy || !hydrated}
                  onChange={(event) =>
                    setPaper(event.target.value as "letter" | "a4")
                  }
                >
                  <NativeSelectOption value="letter">
                    US Letter
                  </NativeSelectOption>
                  <NativeSelectOption value="a4">A4</NativeSelectOption>
                </NativeSelect>
              </Field>
            </div>
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </FieldGroup>
        </SettingsSection>
      </div>
      <PrintableAttendanceSheets sheets={sheets} />
    </main>
  );
}
