import { Fragment } from "react";
import Link from "next/link";
import { MapPin, Trash2 } from "lucide-react";

import { SettingsSection } from "@/components/layout/SettingsSection";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EmptyStateIcon } from "@/components/organization/EmptyStateIcon";

/** One synced event, whichever list it came from. */
export type SyncedEvent = {
  key: string;
  projectId: string;
  title: string;
  start: string;
  end: string | null;
  location: string | null;
  syncedAt: string | null;
};

function formatDate(dateString: string) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateString);
  return new Date(
    dateOnly ? `${dateString}T12:00:00` : dateString,
  ).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(dateOnly
      ? {}
      : { hour: "2-digit" as const, minute: "2-digit" as const }),
  });
}

function SyncedEventRow({
  event,
  disabled,
  onRemove,
}: {
  event: SyncedEvent;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <Item className="flex-nowrap items-start">
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full min-w-0">
          <Link
            href={`/projects/${event.projectId}`}
            className="truncate hover:underline"
          >
            {event.title}
          </Link>
        </ItemTitle>
        <p className="text-muted-foreground text-sm">
          {formatDate(event.start)}
          {event.end && event.end !== event.start
            ? ` - ${formatDate(event.end)}`
            : null}
        </p>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {event.location ? (
            <span className="flex min-w-0 items-center gap-1">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{event.location}</span>
            </span>
          ) : null}
          <span>
            {event.syncedAt
              ? `Synced ${formatDate(event.syncedAt)}`
              : "Sync incomplete. Reopen the project to retry, or remove it."}
          </span>
        </div>
      </ItemContent>
      <ItemActions>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                onClick={onRemove}
                disabled={disabled}
                aria-label={`Remove ${event.title} from calendar`}
              />
            }
          >
            <Trash2 aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent>Remove from calendar</TooltipContent>
        </Tooltip>
      </ItemActions>
    </Item>
  );
}

function SyncedEventGroup<T extends SyncedEvent>({
  label,
  events,
  disabled,
  onRemove,
}: {
  label: string;
  events: T[];
  disabled: boolean;
  onRemove: (event: T) => void;
}) {
  if (events.length === 0) return null;
  return (
    <div className="grid gap-1">
      <h2 className="px-4 text-sm font-medium">
        {label}{" "}
        <span className="text-muted-foreground font-normal">
          ({events.length})
        </span>
      </h2>
      <ItemGroup className="gap-0">
        {events.map((event, index) => (
          <Fragment key={event.key}>
            {index > 0 ? <ItemSeparator className="my-0" /> : null}
            <SyncedEventRow
              event={event}
              disabled={disabled}
              onRemove={() => onRemove(event)}
            />
          </Fragment>
        ))}
      </ItemGroup>
    </div>
  );
}

export function SyncedEventsSection<T extends SyncedEvent>({
  creatorEvents,
  volunteerEvents,
  removing,
  onRemove,
}: {
  creatorEvents: T[];
  volunteerEvents: T[];
  removing: boolean;
  onRemove: (event: T) => void;
}) {
  const total = creatorEvents.length + volunteerEvents.length;

  return (
    <SettingsSection
      title="Synced events"
      description={
        total === 0
          ? "Events you add to your Google Calendar show up here."
          : `${total} ${total === 1 ? "event" : "events"} on your Google Calendar.`
      }
      contentClassName="gap-0 px-0"
    >
      {total === 0 ? (
        <Empty className="p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <EmptyStateIcon name="calendar-check" />
            </EmptyMedia>
            <EmptyTitle>Nothing synced yet</EmptyTitle>
            <EmptyDescription>
              Add a project or signup to your calendar from its page.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4">
          <SyncedEventGroup
            label="Projects you created"
            events={creatorEvents}
            disabled={removing}
            onRemove={onRemove}
          />
          <SyncedEventGroup
            label="Volunteer signups"
            events={volunteerEvents}
            disabled={removing}
            onRemove={onRemove}
          />
        </div>
      )}
    </SettingsSection>
  );
}
