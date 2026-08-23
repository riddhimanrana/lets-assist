import {
  CheckCircle2,
  Cloud,
  Code2,
  PackageCheck,
  ServerCog,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PluginControlPlaneData } from "./actions";

type PluginOverviewProps = {
  data: PluginControlPlaneData;
  onEditPlugin: (pluginKey: string) => void;
  onOpenAccess: (pluginKey?: string) => void;
};

type RuntimeProfile = PluginControlPlaneData["runtimeProfiles"][number];

function runtimeLabel(profiles: RuntimeProfile[]): string {
  const kinds = new Set(profiles.map((profile) => profile.profile));
  if (kinds.has("application") && kinds.has("embedded")) return "Hybrid";
  if (kinds.has("application")) return "Application";
  if (kinds.has("service")) return "Service";
  return "Embedded";
}

function RuntimeIcon({ profiles }: { profiles: RuntimeProfile[] }) {
  const kinds = new Set(profiles.map((profile) => profile.profile));
  if (kinds.has("application")) return <Cloud className="size-4" />;
  if (kinds.has("service")) return <ServerCog className="size-4" />;
  return <Code2 className="size-4" />;
}

function RuntimeRows({ profiles }: { profiles: RuntimeProfile[] }) {
  return (
    <div className="space-y-2">
      {profiles.map((profile) => (
        <div
          key={`${profile.plugin_key}:${profile.profile}`}
          className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/70 px-3 py-2"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <RuntimeIcon profiles={[profile]} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium capitalize">
                {profile.profile === "application"
                  ? "Microfrontend app"
                  : `${profile.profile} runtime`}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {profile.project_name ??
                  (profile.profile === "embedded"
                    ? "Ships with the Let's Assist host"
                    : "Server-only plugin process")}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {profile.signed ? (
              <ShieldCheck className="size-3.5 text-emerald-600" />
            ) : null}
            <span className="font-mono text-xs text-muted-foreground">
              v{profile.version}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PluginOverview({
  data,
  onEditPlugin,
  onOpenAccess,
}: PluginOverviewProps) {
  const activeInstalls = data.installRuntimes.filter(
    (install) => install.enabled,
  );
  const applicationInstalls = activeInstalls.filter(
    (install) => install.application_enabled,
  );
  const attentionCount =
    data.plugins.reduce(
      (count, plugin) => count + plugin.force_pending_count,
      0,
    ) +
    applicationInstalls.filter(
      (install) => install.deployment_healthy === false,
    ).length;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Plugins</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage access, installed versions, runtimes, and deployment
              health.
            </p>
          </div>
          <Button type="button" size="sm" onClick={() => onOpenAccess()}>
            Grant access
          </Button>
        </div>

        <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          {[
            ["Plugins", data.plugins.length, "in the catalog"],
            ["Active installs", activeInstalls.length, "across organizations"],
            ["App runtimes", applicationInstalls.length, "selected now"],
            ["Needs attention", attentionCount, "blocked or forced"],
          ].map(([label, value, detail]) => (
            <div key={label} className="px-5 py-4">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {label}
              </p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums">
                  {value}
                </span>
                <span className="text-xs text-muted-foreground">{detail}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Your plugins</h2>
            <p className="text-sm text-muted-foreground">
              Runtime type, deployed version, and organization usage at a
              glance.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Signed releases show a shield.
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {data.plugins.map((plugin) => {
            const profiles = data.runtimeProfiles.filter(
              (profile) => profile.plugin_key === plugin.key,
            );
            const installs = activeInstalls.filter(
              (install) => install.plugin_key === plugin.key,
            );
            const selectedApplications = installs.filter(
              (install) => install.application_enabled,
            );
            const healthyApplications = selectedApplications.filter(
              (install) => install.deployment_healthy === true,
            );

            return (
              <Card
                key={plugin.key}
                className={cn(
                  "overflow-hidden border-border/70 shadow-sm",
                  !plugin.is_active && "opacity-70",
                )}
              >
                <CardContent className="p-0">
                  <div className="flex items-start justify-between gap-4 border-b bg-muted/15 p-5">
                    <div className="flex min-w-0 gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background shadow-sm">
                        <PackageCheck className="size-5 text-primary" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{plugin.name}</h3>
                          <Badge variant="outline">
                            {runtimeLabel(profiles)}
                          </Badge>
                          <Badge
                            variant={plugin.is_active ? "default" : "secondary"}
                          >
                            {plugin.is_active ? "Active" : "Paused"}
                          </Badge>
                        </div>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {plugin.key}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={
                        plugin.visibility === "global" ? "info" : "outline"
                      }
                    >
                      {plugin.visibility}
                    </Badge>
                  </div>

                  <div className="grid gap-5 p-5 md:grid-cols-[1.15fr_0.85fr]">
                    <div className="space-y-3">
                      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        Release channels
                      </p>
                      <RuntimeRows profiles={profiles} />
                    </div>

                    <div className="space-y-3">
                      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        Organization state
                      </p>
                      <div className="rounded-xl border bg-muted/15 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm">Installed</span>
                          <span className="font-medium tabular-nums">
                            {installs.length}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <span className="text-sm">Using app</span>
                          <span className="font-medium tabular-nums">
                            {selectedApplications.length}
                          </span>
                        </div>
                        {selectedApplications.length > 0 ? (
                          <div className="mt-3 border-t pt-3">
                            <div className="flex items-center gap-2 text-xs">
                              <CheckCircle2
                                className={cn(
                                  "size-3.5",
                                  healthyApplications.length ===
                                    selectedApplications.length
                                    ? "text-emerald-600"
                                    : "text-amber-600",
                                )}
                              />
                              <span className="text-muted-foreground">
                                {healthyApplications.length ===
                                selectedApplications.length
                                  ? "Selected deployments are healthy"
                                  : "Check the selected deployment"}
                              </span>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/10 px-5 py-3">
                    <p className="text-xs text-muted-foreground">
                      Catalog v{plugin.latest_version}
                      {plugin.force_update_version
                        ? ` · security floor v${plugin.force_update_version}`
                        : " · manual updates"}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onOpenAccess(plugin.key)}
                      >
                        Access
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onEditPlugin(plugin.key)}
                      >
                        Edit details
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
