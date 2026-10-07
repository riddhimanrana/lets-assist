"use client";

import type { ReactNode } from "react";

import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { ReportType } from "../actions";
import { RangeBuilder } from "./RangeBuilder";
import { reportTypeLabels } from "./sheet-sync-options";
import type { SheetSyncSetup } from "./useSheetSyncSetup";

/** Report type, tab name and range: the same three fields in every state. */
export function SheetDestinationFields({
  idPrefix,
  destination,
  disabled,
  tabNameHint,
  rangeHint,
  rangeFooter,
}: {
  idPrefix: string;
  destination: SheetSyncSetup["destination"];
  disabled?: boolean;
  tabNameHint?: string;
  rangeHint: string;
  rangeFooter?: ReactNode;
}) {
  return (
    <FieldGroup>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-report-type`}>
            Report type
          </FieldLabel>
          <Select
            value={destination.sheetReportType}
            onValueChange={(value) =>
              destination.setSheetReportType(value as ReportType)
            }
            disabled={disabled}
          >
            <SelectTrigger id={`${idPrefix}-report-type`} className="w-full">
              <SelectValue placeholder="Select report">
                {reportTypeLabels[destination.sheetReportType]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="member-hours">
                  Member Hours Summary
                </SelectItem>
                <SelectItem value="project-summary">Project Summary</SelectItem>
                <SelectItem value="monthly-summary">Monthly Hours</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor={`${idPrefix}-tab-name`}>
            Sheet tab name
          </FieldLabel>
          <Input
            id={`${idPrefix}-tab-name`}
            value={destination.sheetTabName}
            onChange={(event) =>
              destination.setSheetTabName(event.target.value)
            }
            placeholder="Member Hours"
            disabled={disabled}
          />
          {tabNameHint ? (
            <FieldDescription>{tabNameHint}</FieldDescription>
          ) : null}
        </Field>
      </div>

      <div className="grid gap-2">
        <p className="text-sm font-medium">Range</p>
        <RangeBuilder
          {...destination.range}
          disabled={disabled}
          helperText={rangeHint}
        />
        {rangeFooter}
      </div>
    </FieldGroup>
  );
}
