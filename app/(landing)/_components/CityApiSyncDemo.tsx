"use client";
import { useState } from "react";
import Image from "next/image";
import { Globe, Settings2, Workflow, Check, ShieldCheck } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type CitySyncSource =
  | {
      type: "logo";
      logo: string;
      name: string;
      key: string;
      status: string;
      lastRun: string;
      rows: string;
    }
  | {
      type: "icon";
      icon: typeof Globe;
      name: string;
      key: string;
      status: string;
      lastRun: string;
      rows: string;
    };

const citySyncSources: CitySyncSource[] = [
  {
    type: "logo",
    logo: "/resources/google-drive-logo-2026.png",
    name: "Google Drive evidence",
    key: "drive://san-ramon/events",
    status: "Connected",
    lastRun: "2 min ago",
    rows: "146 files",
  },
  {
    type: "logo",
    logo: "/resources/google-sheets-logo-2026.png",
    name: "Volunteer roster sheet",
    key: "sheets://SRCA volunteer ledger",
    status: "Connected",
    lastRun: "4 min ago",
    rows: "1,284 rows",
  },
  {
    type: "logo",
    logo: "/resources/google-calendar-logo-2026.png",
    name: "City operations calendar",
    key: "calendar://parks-public-events",
    status: "Connected",
    lastRun: "9 min ago",
    rows: "38 events",
  },
  {
    type: "icon",
    icon: Globe,
    name: "San Ramon parks permits API",
    key: "api.sanramon.ca.gov/v2/permits",
    status: "Rate limited",
    lastRun: "18 min ago",
    rows: "7 pending",
  },
];

const citySyncRuns = [
  {
    id: "run_8f41",
    source: "Google Drive evidence",
    result: "23 files indexed",
    duration: "12.4s",
    status: "Success",
  },
  {
    id: "run_8f40",
    source: "Volunteer roster sheet",
    result: "91 volunteers reconciled",
    duration: "7.8s",
    status: "Success",
  },
  {
    id: "run_8f39",
    source: "Parks permits API",
    result: "Retry scheduled after 429",
    duration: "2.1s",
    status: "Warning",
  },
  {
    id: "run_8f38",
    source: "AI intake classifier",
    result: "14 draft shifts created",
    duration: "31.6s",
    status: "Review",
  },
];

export function CityApiSyncPluginTab() {
  const [demoAction, setDemoAction] = useState<string | null>(null);
  return (
    <Card className="overflow-hidden border-border/60 bg-background/95 shadow-sm">
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">Enabled</Badge>
              <Badge variant="outline">city-api-sync</Badge>
              <Badge variant="secondary">v1.8.2</Badge>
              <Badge variant="secondary" className="bg-success/10 text-success">
                Tenant isolated
              </Badge>
            </div>
            <CardTitle className="text-2xl tracking-tight">
              City API Sync
            </CardTitle>
            <CardDescription>
              Illustrative organization integration for city permits, Drive
              files, Sheets rosters, and Calendar events. Personal Connections
              supports Calendar; organization Sheets setup lives under Reports.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setDemoAction(
                  "This is an illustrative plugin. In your organization, admins configure installed integrations in Settings.",
                )
              }
            >
              <Settings2 data-icon="inline-start" />
              Configure
            </Button>
            <Button
              size="sm"
              onClick={() =>
                setDemoAction(
                  "Demo sync complete. No accounts were connected and no data was changed.",
                )
              }
            >
              <Workflow data-icon="inline-start" />
              Run sync now
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {demoAction && (
          <p role="status" className="rounded-lg border p-3 text-sm">
            {demoAction}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Records ingested", "18.4k", "+612 today"],
            ["Queued for review", "43", "AI confidence < 92%"],
            ["Duplicates merged", "412", "last 30 days"],
            ["Approval SLA", "11 min", "median"],
          ].map(([label, value, helper]) => (
            <div
              key={label}
              className="rounded-xl border border-border/70 bg-muted/20 p-4"
            >
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">
                {value}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-border/70 bg-muted/15">
            <div className="border-b border-border/70 p-4">
              <p className="text-sm font-semibold">Connected sources</p>
              <p className="text-xs text-muted-foreground">
                Data sources owned by this organization only.
              </p>
            </div>
            <div className="divide-y divide-border/70">
              {citySyncSources.map((source) => (
                <div key={source.name} className="flex items-center gap-3 p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background shadow-xs">
                    {source.type === "logo" ? (
                      <Image
                        src={source.logo}
                        alt={source.name}
                        width={24}
                        height={24}
                        className="size-6 object-contain"
                      />
                    ) : (
                      <source.icon className="h-5 w-5 text-primary" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {source.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {source.key}
                    </p>
                  </div>
                  <div className="hidden text-right text-xs text-muted-foreground sm:block">
                    <p>{source.rows}</p>
                    <p>{source.lastRun}</p>
                  </div>
                  <Badge
                    variant={
                      source.status === "Connected" ? "secondary" : "outline"
                    }
                    className={
                      source.status === "Connected"
                        ? "bg-success/10 text-success"
                        : "text-info"
                    }
                  >
                    {source.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Plugin workflow</p>
                  <p className="text-xs text-muted-foreground">
                    Private queue, AI review, and scoped writes.
                  </p>
                </div>
                <Workflow className="h-5 w-5 text-primary" />
              </div>
              <div className="mt-4 grid gap-2">
                {[
                  ["Fetch", "API, Drive, Sheets, Calendar"],
                  ["Normalize", "dedupe, map fields, detect conflicts"],
                  ["AI review", "draft shifts, classify waivers, flag risk"],
                  ["Publish", "organization-scoped projects and reports"],
                ].map(([label, body]) => (
                  <div
                    key={label}
                    className="flex items-center gap-3 rounded-lg border bg-background/70 p-3"
                  >
                    <Check className="h-4 w-4 text-success" />
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-success" />
                Runtime boundary
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Reads and writes use organization-scoped plugin tables, explicit
                service routes, and audit logs. No other organization can query
                this plugin dataset.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-muted/15">
          <div className="border-b border-border/70 p-4">
            <p className="text-sm font-semibold">Recent sync runs</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border/70 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Run</th>
                  <th className="px-4 py-3 text-left font-medium">Source</th>
                  <th className="px-4 py-3 text-left font-medium">Result</th>
                  <th className="px-4 py-3 text-left font-medium">Duration</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {citySyncRuns.map((run) => (
                  <tr key={run.id}>
                    <td className="px-4 py-3 font-mono text-xs">{run.id}</td>
                    <td className="px-4 py-3">{run.source}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {run.result}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {run.duration}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={
                          run.status === "Success" ? "secondary" : "outline"
                        }
                        className={
                          run.status === "Success"
                            ? "bg-success/10 text-success"
                            : "text-info"
                        }
                      >
                        {run.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
