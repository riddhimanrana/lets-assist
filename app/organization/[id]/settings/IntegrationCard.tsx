import type { ComponentProps, ReactNode } from "react";
import Image from "next/image";

import { SettingsSection } from "@/components/layout/SettingsSection";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export type IntegrationState =
  "loading" | "connected" | "needs-reconnect" | "not-connected";

export type IntegrationDetail = {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
};

const stateBadges: Record<
  Exclude<IntegrationState, "loading">,
  { label: string; variant: "success" | "warning" | "outline" }
> = {
  connected: { label: "Connected", variant: "success" },
  "needs-reconnect": { label: "Needs reconnect", variant: "warning" },
  "not-connected": { label: "Not connected", variant: "outline" },
};

/**
 * One layout for every Google integration: the logo and name, a status badge
 * (connected, needs reconnect, not connected), the connection details as rows,
 * then the integration's own options, with the actions in the footer.
 */
export function IntegrationCard({
  name,
  description,
  logo,
  state,
  details = [],
  notice,
  footer,
  footerHint,
  children,
  ...props
}: Omit<
  ComponentProps<typeof SettingsSection>,
  "title" | "status" | "description" | "footer" | "footerHint"
> & {
  name: string;
  description: ReactNode;
  logo: { src: string; width: number; height: number };
  state: IntegrationState;
  details?: IntegrationDetail[];
  notice?: ReactNode;
  footer?: ReactNode;
  footerHint?: ReactNode;
}) {
  const badge = state === "loading" ? null : stateBadges[state];

  return (
    <SettingsSection
      title={
        <span className="flex items-center gap-2">
          <Image
            src={logo.src}
            alt=""
            width={logo.width}
            height={logo.height}
            className="h-5 w-auto object-contain"
          />
          {name}
        </span>
      }
      description={description}
      status={
        badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : null
      }
      footer={state === "loading" ? null : footer}
      footerHint={state === "loading" ? null : footerHint}
      {...props}
    >
      {state === "loading" ? (
        <div
          className="grid gap-2"
          role="status"
          aria-label={`Loading ${name} status`}
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <>
          {notice}
          {details.length > 0 ? (
            <dl className="divide-border divide-y rounded-md border">
              {details.map((detail) => (
                <div
                  key={detail.label}
                  className="grid gap-1 px-3 py-2.5 sm:grid-cols-[10rem_1fr] sm:gap-4"
                >
                  <dt className="text-muted-foreground text-sm">
                    {detail.label}
                  </dt>
                  <dd className="grid min-w-0 gap-0.5">
                    <span className="text-sm font-medium break-words">
                      {detail.value}
                    </span>
                    {detail.helper ? (
                      <span className="text-muted-foreground text-sm">
                        {detail.helper}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {children}
        </>
      )}
    </SettingsSection>
  );
}

/** A labelled option inside an integration card: text left, control right. */
export function IntegrationOption({
  label,
  description,
  htmlFor,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="grid gap-0.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </label>
        ) : (
          <p className="text-sm font-medium">{label}</p>
        )}
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
