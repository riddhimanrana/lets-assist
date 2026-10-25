// EventType Component - Handles the event type selection step

"use client";

import { OptionCard, OptionRadioDot, StepSection } from "./form-parts";

type EventTypeValue = "oneTime" | "multiDay" | "sameDayMultiArea";

interface EventTypeProps {
  eventType: EventTypeValue;
  setEventTypeAction: (type: EventTypeValue) => void;
}

const EVENT_TYPES: {
  type: EventTypeValue;
  title: string;
  description: string;
  example: string;
}[] = [
  {
    type: "oneTime",
    title: "Single event",
    description: "A one-time event on a specific date",
    example: "Beach cleanup event on Feb 20th, 2024 from 4 PM to 9 PM",
  },
  {
    type: "multiDay",
    title: "Multiple day event",
    description: "Event spans across multiple days with different time slots",
    example:
      "Workshop series with morning and afternoon sessions across different days",
  },
  {
    type: "sameDayMultiArea",
    title: "Multi-role event",
    description: "Single day event with different volunteer roles",
    example:
      "Community festival needing decorators, cooks, and cleaners at different times",
  },
];

export default function EventType({
  eventType,
  setEventTypeAction,
}: EventTypeProps) {
  return (
    <StepSection
      title="Choose event type"
      titleId="event-type-heading"
      description="Select the format that best fits your event"
    >
      <fieldset
        aria-labelledby="event-type-heading"
        className="grid min-w-0 gap-3 p-4 sm:p-6"
      >
        {EVENT_TYPES.map(({ type, title, description, example }) => {
          const selected = eventType === type;

          return (
            <OptionCard
              key={type}
              selected={selected}
              title={title}
              titleId={`event-type-${type}-title`}
              titleAs="h3"
              description={description}
              descriptionId={`event-type-${type}-description`}
              control={
                <>
                  <input
                    type="radio"
                    name="event-type"
                    value={type}
                    checked={selected}
                    onChange={() => setEventTypeAction(type)}
                    aria-labelledby={`event-type-${type}-title`}
                    aria-describedby={`event-type-${type}-description`}
                    className="sr-only"
                  />
                  <OptionRadioDot selected={selected} />
                </>
              }
            >
              {selected && (
                <span className="text-muted-foreground mt-1 block border-l-2 pl-3 text-sm">
                  For example: {example}
                </span>
              )}
            </OptionCard>
          );
        })}
      </fieldset>
    </StepSection>
  );
}
