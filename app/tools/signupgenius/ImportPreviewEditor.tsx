"use client";

import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import type { ImportPreview } from "@/lib/signupgenius/model";
import type { ImportReadinessIssues } from "@/lib/signupgenius/readiness";

export default function ImportPreviewEditor({
  preview,
  onChange,
  issues,
}: {
  preview: ImportPreview;
  onChange: (p: ImportPreview) => void;
  issues: ImportReadinessIssues;
}) {
  const validation = (key: string, id: string) => ({
    "aria-invalid": !!issues[key],
    "aria-describedby": issues[key] ? `${id}-error` : undefined,
  });
  const error = (key: string, id: string) =>
    issues[key] ? (
      <FieldError id={`${id}-error`}>{issues[key]}</FieldError>
    ) : null;
  const update = (
    key: "title" | "description" | "location" | "timezone",
    value: string,
  ) => onChange({ ...preview, [key]: value });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your project preview</CardTitle>
        <CardDescription>
          Check the original signup and correct anything that needs attention.
          Capacities are total places, not remaining places.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Field>
          <FieldLabel htmlFor="import-title">Project title</FieldLabel>
          <Input
            id="import-title"
            {...validation("title", "import-title")}
            maxLength={200}
            required
            value={preview.title}
            onChange={(e) => update("title", e.target.value)}
          />
          {error("title", "import-title")}
        </Field>
        <Field>
          <FieldLabel htmlFor="import-description">Description</FieldLabel>
          <Textarea
            id="import-description"
            {...validation("description", "import-description")}
            required
            maxLength={10000}
            rows={6}
            value={preview.description}
            onChange={(e) => update("description", e.target.value)}
          />
          {error("description", "import-description")}
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="import-location">Location</FieldLabel>
            <Input
              id="import-location"
              {...validation("location", "import-location")}
              required
              maxLength={500}
              value={preview.location}
              onChange={(e) => update("location", e.target.value)}
            />
            {error("location", "import-location")}
          </Field>
          <Field>
            <FieldLabel htmlFor="import-timezone">Event timezone</FieldLabel>
            <Input
              id="import-timezone"
              {...validation("timezone", "import-timezone")}
              required
              maxLength={100}
              placeholder="America/Los_Angeles"
              value={preview.timezone ?? ""}
              onChange={(e) => update("timezone", e.target.value)}
            />
            {error("timezone", "import-timezone")}
            <p className="text-sm text-muted-foreground">
              Use the event's timezone, which may differ from yours.
            </p>
          </Field>
        </div>
        <div className="space-y-5">
          <h3 className="font-medium">
            Volunteer slots ({preview.slots.length})
          </h3>
          {preview.slots.map((slot, index) => {
            const change = (key: keyof typeof slot, value: string | number) =>
              onChange({
                ...preview,
                slots: preview.slots.map((s, i) =>
                  i === index ? { ...s, [key]: value } : s,
                ),
              });
            const prefix = `slot-${index}`;
            return (
              <fieldset key={index} className="space-y-3 border-t pt-4">
                <legend className="text-sm font-medium">
                  Slot {index + 1}
                </legend>
                {slot.sourceTiming && (
                  <p className="break-words text-sm text-muted-foreground">
                    Original source timing: {slot.sourceTiming.start} to{" "}
                    {slot.sourceTiming.end}. An offset alone does not identify
                    the event's regional timezone.
                  </p>
                )}
                <Field>
                  <FieldLabel htmlFor={`${prefix}-name`}>Slot name</FieldLabel>
                  <Input
                    id={`${prefix}-name`}
                    {...validation(`slots.${index}.name`, `${prefix}-name`)}
                    required
                    maxLength={200}
                    value={slot.name}
                    onChange={(e) => change("name", e.target.value)}
                  />
                  {error(`slots.${index}.name`, `${prefix}-name`)}
                </Field>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field>
                    <FieldLabel htmlFor={`${prefix}-date`}>Date</FieldLabel>
                    <Input
                      className="min-w-0"
                      id={`${prefix}-date`}
                      {...validation(`slots.${index}.date`, `${prefix}-date`)}
                      required
                      type="date"
                      value={slot.date}
                      onChange={(e) => change("date", e.target.value)}
                    />
                    {error(`slots.${index}.date`, `${prefix}-date`)}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${prefix}-capacity`}>
                      Total places
                    </FieldLabel>
                    <Input
                      id={`${prefix}-capacity`}
                      {...validation(
                        `slots.${index}.capacity`,
                        `${prefix}-capacity`,
                      )}
                      required
                      type="number"
                      min={1}
                      max={10000}
                      value={slot.capacity}
                      onChange={(e) =>
                        change("capacity", Number(e.target.value))
                      }
                    />
                    {error(`slots.${index}.capacity`, `${prefix}-capacity`)}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${prefix}-start`}>
                      Start time
                    </FieldLabel>
                    <Input
                      className="min-w-0"
                      id={`${prefix}-start`}
                      {...validation(
                        `slots.${index}.startTime`,
                        `${prefix}-start`,
                      )}
                      required
                      type="time"
                      value={slot.startTime}
                      onChange={(e) => change("startTime", e.target.value)}
                    />
                    {error(`slots.${index}.startTime`, `${prefix}-start`)}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${prefix}-end`}>End time</FieldLabel>
                    <Input
                      className="min-w-0"
                      id={`${prefix}-end`}
                      {...validation(`slots.${index}.endTime`, `${prefix}-end`)}
                      required
                      type="time"
                      value={slot.endTime}
                      onChange={(e) => change("endTime", e.target.value)}
                    />
                    {error(`slots.${index}.endTime`, `${prefix}-end`)}
                  </Field>
                </div>
              </fieldset>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
