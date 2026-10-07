import Image from "next/image";

import { SettingsSection } from "@/components/layout/SettingsSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import type { CalendarConnection } from "@/types";

const HOW_IT_WORKS = [
  "Let's Assist only asks for permission to create and manage events.",
  "When you create a project or sign up to volunteer, you can add it to your calendar.",
  "If a project is updated or cancelled, its calendar event is updated or removed.",
  "Don't use Google Calendar? You can download .ics files for Apple Calendar, Outlook, and other calendar apps.",
];

function formatConnectedDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function CalendarConnectionSection({
  connection,
  legacyReconnectRequired,
  isDisconnecting,
  onConnect,
  onDisconnect,
}: {
  connection: Pick<CalendarConnection, "calendar_email" | "created_at"> | null;
  legacyReconnectRequired: boolean;
  isDisconnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const status = connection ? (
    <Badge variant="success">Connected</Badge>
  ) : legacyReconnectRequired ? (
    <Badge variant="warning">Reconnect required</Badge>
  ) : (
    <Badge variant="outline">Not connected</Badge>
  );

  return (
    <SettingsSection
      title="Google Calendar"
      description="Events you add from a project or signup appear in this calendar."
      status={status}
      contentClassName="gap-0 px-0"
    >
      <Item className="flex-col items-stretch sm:flex-row sm:flex-nowrap sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <ItemMedia variant="image" className="size-8 rounded-none">
            <Image
              src="/resources/google-calendar-logo-2026.png"
              alt=""
              width={32}
              height={32}
            />
          </ItemMedia>
          <ItemContent className="min-w-0">
            {connection ? (
              <>
                <ItemTitle className="line-clamp-none break-all">
                  {connection.calendar_email}
                </ItemTitle>
                <ItemDescription>
                  Connected on {formatConnectedDate(connection.created_at)}
                </ItemDescription>
              </>
            ) : (
              <>
                <ItemTitle className="line-clamp-none">
                  {legacyReconnectRequired
                    ? "Reconnect required"
                    : "No calendar connected"}
                </ItemTitle>
                <ItemDescription className="line-clamp-none">
                  {legacyReconnectRequired
                    ? "This older Google connection has no verified purpose. Reconnect it to sync events."
                    : "Connect your Google Calendar to sync events automatically."}
                </ItemDescription>
              </>
            )}
          </ItemContent>
        </div>
        <ItemActions>
          {connection ? (
            <Button
              variant="outline"
              onClick={onDisconnect}
              disabled={isDisconnecting}
              className="w-full sm:w-auto"
            >
              Disconnect
            </Button>
          ) : (
            <Button onClick={onConnect} className="w-full sm:w-auto">
              {legacyReconnectRequired
                ? "Reconnect Google Calendar"
                : "Connect Google Calendar"}
            </Button>
          )}
        </ItemActions>
      </Item>

      {!connection && (
        <>
          <ItemSeparator className="my-0" />
          <div className="grid gap-2 px-4 pt-4">
            <h2 className="text-sm font-medium">How it works</h2>
            <ul className="text-muted-foreground grid list-disc gap-1 pl-5 text-sm">
              {HOW_IT_WORKS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </SettingsSection>
  );
}
