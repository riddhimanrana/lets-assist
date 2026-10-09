"use client";

import { useId, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { DatePicker } from "@/components/ui/date-picker";
import { Field, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

export function AttendanceExport({
  scope,
  scopeId,
  sessionId,
  projects,
}: {
  scope: "project" | "organization";
  scopeId: string;
  sessionId?: string;
  projects?: Array<{ id: string; title: string }>;
}) {
  const id = useId();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeUnpublished, setIncludeUnpublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState("");
  async function download(format: "csv" | "json") {
    setBusy(true);
    try {
      const query = new URLSearchParams({
        format,
        includeUnpublished: String(includeUnpublished),
      });
      if (from) query.set("from", from);
      if (to) query.set("to", to);
      if (sessionId && sessionId !== "all") query.set("sessionId", sessionId);
      if (scope === "organization" && projectId)
        query.set("projectId", projectId);
      const response = await fetch(
        `/api/${scope}s/${encodeURIComponent(scopeId)}/hours/export?${query}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Export failed");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${scope}-${scopeId}-hours.${format}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      role="region"
      aria-label="Export volunteer hours"
      className="gap-4 p-4"
    >
      <div className="grid gap-1">
        <h3 className="font-medium">Export volunteer hours</h3>
        <p className="text-muted-foreground text-sm">
          Includes guests and volunteers outside the organization. Dates use
          each project's timezone.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {scope === "organization" && projects && (
          <Field className="w-auto max-w-full gap-2">
            <FieldLabel htmlFor={`${id}-project`}>Project</FieldLabel>
            <NativeSelect
              id={`${id}-project`}
              className="max-w-full [&_select]:h-9"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <NativeSelectOption value="">
                All organization projects
              </NativeSelectOption>
              {projects.map((project) => (
                <NativeSelectOption key={project.id} value={project.id}>
                  {project.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field className="w-40 gap-2">
          <FieldLabel htmlFor={`${id}-from`}>From</FieldLabel>
          <DatePicker
            id={`${id}-from`}
            value={from}
            onChange={setFrom}
            maxDate={to || undefined}
            placeholder="Any date"
          />
        </Field>
        <Field className="w-40 gap-2">
          <FieldLabel htmlFor={`${id}-to`}>Through</FieldLabel>
          <DatePicker
            id={`${id}-to`}
            value={to}
            onChange={setTo}
            minDate={from || undefined}
            placeholder="Any date"
          />
        </Field>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => download("csv")}
        >
          <Download data-icon="inline-start" />
          Export CSV
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => download("json")}
        >
          <Download data-icon="inline-start" />
          Export JSON
        </Button>
        {from || to ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            Clear dates
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-unpublished`}
          checked={includeUnpublished}
          onCheckedChange={(value) => setIncludeUnpublished(value === true)}
        />
        <Label htmlFor={`${id}-unpublished`}>
          Include pending and unresolved attendance without credited hours
        </Label>
      </div>
    </Card>
  );
}
