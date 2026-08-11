"use client";

import { useState } from "react";
import { TZDate } from "@date-fns/tz";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { ButtonGroup } from "@/components/ui/button-group";
import { Spinner } from "@/components/ui/spinner";
import { useIsMobile } from "@/hooks/use-mobile";

import { updatePaperScanRow } from "./actions";
import type { PaperScanRowView } from "./PaperSignupsClient";

interface ReviewRowEditorProps {
  projectId: string;
  batchId: string;
  row: PaperScanRowView;
  timezone: string;
  window: { startsAt: number; endsAt: number } | null;
  onClose: () => void;
  onSaved: (row: PaperScanRowView) => void;
}

/** ISO instant -> "HH:MM" wall clock in the project timezone. */
function isoToLocalTime(iso: string | null, timezone: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "HH:MM" wall clock on the slot's local date -> ISO instant. */
function localTimeToIso(
  time: string,
  timezone: string,
  window: { startsAt: number; endsAt: number } | null,
): string | null {
  if (!time || !window) return null;
  const [hours, minutes] = time.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  const slotStart = new TZDate(window.startsAt, timezone);
  let instant = new TZDate(
    slotStart.getFullYear(),
    slotStart.getMonth(),
    slotStart.getDate(),
    hours,
    minutes,
    0,
    timezone,
  ).getTime();
  // Overnight slots: a time before the start belongs to the next day.
  if (instant < window.startsAt && window.endsAt - window.startsAt > 0) {
    const nextDay = instant + 24 * 60 * 60 * 1000;
    if (nextDay <= window.endsAt) instant = nextDay;
  }
  return new Date(instant).toISOString();
}

/**
 * One form body, two shells: a Drawer on mobile, a Dialog on desktop.
 */
export function ReviewRowEditor({
  projectId,
  batchId,
  row,
  timezone,
  window,
  onClose,
  onSaved,
}: ReviewRowEditorProps) {
  const isMobile = useIsMobile();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: row.name ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    timeIn: isoToLocalTime(row.checkInTime, timezone),
    timeOut: isoToLocalTime(row.checkOutTime, timezone),
    signaturePresent: row.signaturePresent,
  });

  const save = async () => {
    setSaving(true);
    const checkInTime = localTimeToIso(form.timeIn, timezone, window);
    const checkOutTime = localTimeToIso(form.timeOut, timezone, window);
    const patch = {
      name: form.name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      checkInTime,
      checkOutTime,
      signaturePresent: form.signaturePresent,
    };
    const result = await updatePaperScanRow({
      projectId,
      batchId,
      rowId: row.id,
      patch,
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    onSaved({
      ...row,
      name: patch.name,
      email: patch.email?.toLowerCase() ?? null,
      phone: patch.phone,
      checkInTime,
      checkOutTime,
      signaturePresent: form.signaturePresent,
    });
  };

  const body = (
    <FieldGroup className="px-4 pb-6 sm:px-0 sm:pb-0">
      <Field>
        <FieldLabel htmlFor="paper-row-name">Name</FieldLabel>
        <Input
          id="paper-row-name"
          value={form.name}
          onChange={(event) =>
            setForm((current) => ({ ...current, name: event.target.value }))
          }
          autoComplete="off"
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="paper-row-email">Email</FieldLabel>
        <Input
          id="paper-row-email"
          type="email"
          value={form.email}
          onChange={(event) =>
            setForm((current) => ({ ...current, email: event.target.value }))
          }
          autoComplete="off"
          placeholder="Leave empty for roster-only"
        />
        <FieldDescription>
          Rows without an email are kept as roster entries and don&apos;t get
          hours or certificates.
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="paper-row-phone">Phone</FieldLabel>
        <Input
          id="paper-row-phone"
          type="tel"
          value={form.phone}
          onChange={(event) =>
            setForm((current) => ({ ...current, phone: event.target.value }))
          }
          autoComplete="off"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="paper-row-time-in">Time in</FieldLabel>
          <Input
            id="paper-row-time-in"
            type="time"
            value={form.timeIn}
            onChange={(event) =>
              setForm((current) => ({ ...current, timeIn: event.target.value }))
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="paper-row-time-out">Time out</FieldLabel>
          <Input
            id="paper-row-time-out"
            type="time"
            value={form.timeOut}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                timeOut: event.target.value,
              }))
            }
          />
        </Field>
      </div>

      <Field orientation="horizontal">
        <Checkbox
          id="paper-row-signature"
          checked={form.signaturePresent}
          onCheckedChange={(checked) =>
            setForm((current) => ({
              ...current,
              signaturePresent: checked === true,
            }))
          }
        />
        <FieldLabel htmlFor="paper-row-signature" className="font-normal">
          Signature present on the sheet
        </FieldLabel>
      </Field>

      <ButtonGroup>
        <Button onClick={save} disabled={saving}>
          {saving ? <Spinner /> : null}
          {saving ? "Saving…" : "Save row"}
        </Button>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
      </ButtonGroup>
    </FieldGroup>
  );

  const title = `Row ${row.sheetRowNumber}`;
  const description =
    "Correct anything the scan misread — compare against the photo above.";

  if (isMobile) {
    return (
      <Drawer open onOpenChange={(open) => !open && onClose()}>
        <DrawerContent>
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          {body}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
