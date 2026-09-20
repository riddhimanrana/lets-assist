"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

export function AttendanceExport({
  scope,
  scopeId,
}: {
  scope: "project" | "organization";
  scopeId: string;
}) {
  const id = useId();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeUnpublished, setIncludeUnpublished] = useState(false);
  const [busy, setBusy] = useState(false);
  async function download(format: "csv" | "json") {
    setBusy(true);
    try {
      const query = new URLSearchParams({
        format,
        includeUnpublished: String(includeUnpublished),
      });
      if (from) query.set("from", from);
      if (to) query.set("to", to);
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
    <section
      aria-label="Export volunteer hours"
      className="space-y-3 rounded-lg border p-4"
    >
      <div>
        <h3 className="font-medium">Export volunteer hours</h3>
        <p className="text-sm text-muted-foreground">
          Includes guests and volunteers outside the organization. Dates use
          each project's timezone.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor={`${id}-from`}>From</Label>
          <Input
            id={`${id}-from`}
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-to`}>Through</Label>
          <Input
            id={`${id}-to`}
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => download("csv")}
        >
          Export CSV
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => download("json")}
        >
          Export JSON
        </Button>
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
    </section>
  );
}
