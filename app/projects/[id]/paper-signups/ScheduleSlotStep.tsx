"use client";

import { CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FieldLabel } from "@/components/ui/field";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

import type { PaperScanSlotOption } from "./PaperSignupsClient";

interface ScheduleSlotStepProps {
  slotOptions: PaperScanSlotOption[];
  timezone: string;
  selectedSlotId: string | null;
  onSelect: (slotId: string) => void;
  onContinue: () => void;
}

function formatWindow(option: PaperScanSlotOption, timezone: string): string {
  const start = new Date(option.windowStartsAt);
  const end = new Date(option.windowEndsAt);
  const date = start.toLocaleDateString("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = (value: Date) =>
    value.toLocaleTimeString("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    });
  return `${date} · ${time(start)} – ${time(end)}`;
}

/**
 * One paper sheet belongs to one slot. The date/time range on each option is
 * how the organizer recognizes which physical sheet they are holding.
 */
export function ScheduleSlotStep({
  slotOptions,
  timezone,
  selectedSlotId,
  onSelect,
  onContinue,
}: ScheduleSlotStepProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Which session is this sheet for?</CardTitle>
        <CardDescription>
          Each scan records attendance for a single session. Scan multiple
          sheets one at a time.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {slotOptions.length === 0 ? (
          <Empty>
            <EmptyMedia variant="icon">
              <CalendarClock />
            </EmptyMedia>
            <EmptyTitle>No scannable sessions</EmptyTitle>
            <EmptyDescription>
              This project&apos;s schedule could not be resolved, so paper
              sheets can&apos;t be attributed to a session.
            </EmptyDescription>
          </Empty>
        ) : (
          <RadioGroup
            value={selectedSlotId ?? undefined}
            onValueChange={(value) => onSelect(String(value))}
            aria-label="Session for this sheet"
          >
            {slotOptions.map((option) => (
              <FieldLabel key={option.id} htmlFor={`slot-${option.id}`}>
                <Item variant="outline" className="w-full">
                  <ItemMedia>
                    <RadioGroupItem
                      id={`slot-${option.id}`}
                      value={option.id}
                    />
                  </ItemMedia>
                  <ItemMedia variant="icon">
                    <CalendarClock />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{option.label}</ItemTitle>
                    <ItemDescription>
                      {formatWindow(option, timezone)}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </FieldLabel>
            ))}
          </RadioGroup>
        )}
      </CardContent>
      <CardFooter>
        <Button
          disabled={!selectedSlotId}
          onClick={onContinue}
          className="w-full sm:w-auto"
        >
          Continue to photos
        </Button>
      </CardFooter>
    </Card>
  );
}
