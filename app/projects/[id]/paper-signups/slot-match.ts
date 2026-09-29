import type { PaperScanSlotOption } from "./PaperSignupsClient";

export function paperScanSlotMatches(
  slot: PaperScanSlotOption,
  scheduleId: string | null | undefined,
): boolean {
  return (
    !!scheduleId &&
    (slot.id === scheduleId || !!slot.aliases?.includes(scheduleId))
  );
}

export function findPaperScanSlot(
  slots: PaperScanSlotOption[],
  scheduleId: string | null | undefined,
): PaperScanSlotOption | null {
  return slots.find((slot) => paperScanSlotMatches(slot, scheduleId)) ?? null;
}

export function isPaperScanSlotPublished(
  slot: PaperScanSlotOption | null,
  published: Record<string, boolean>,
): boolean {
  if (!slot) return false;
  return [slot.id, slot.publishKey, ...(slot.aliases ?? [])].some(
    (id) => !!id && published[id] === true,
  );
}
