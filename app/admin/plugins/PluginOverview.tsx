import { Cloud, Code2, ServerCog, ShieldCheck } from "lucide-react";

import { SectionHeader } from "@/components/layout/PageHeader";
import { StatStrip } from "@/components/layout/SettingsSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <ul className="divide-y">
      {profiles.map((profile) => (
        <li
          key={`${profile.plugin_key}:${profile.profile}`}
          className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="text-muted-foreground shrink-0" aria-hidden="true">
              <RuntimeIcon profiles={[profile]} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium capitalize">
                {profile.profile === "application"
                  ? "Microfrontend app"
                  : `${profile.profile} runtime`}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {profile.project_name ??
                  (profile.profile === "embedded"
                    ? "Ships with the Let's Assist host"
                    : "Server-only plugin process")}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {profile.signed ? (
              <ShieldCheck
                className="text-success size-3.5"
                aria-label="Signed release"
              />
            ) : null}
            <span className="text-muted-foreground font-mono text-xs">
              v{profile.version}
            </span>
          </div>
        </li>
      ))}
    </ul>
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
    <div className="grid gap-6">
      <StatStrip
        items={[
          {
            label: "Plugins",
            value: data.plugins.length,
            helper: "in the catalog",
          },
          {
            label: "Active installs",
            value: activeInstalls.length,
            helper: "across organizations",
          },
          {
            label: "App runtimes",
            value: applicationInstalls.length,
            helper: "selected now",
          },
          {
            label: "Needs attention",
            value: attentionCount,
            helper: "blocked or forced",
          },
        ]}
      />

      <section className="grid gap-4">
        <SectionHeader
          title="Your plugins"
          description="Runtime type, deployed version, and organization usage at a glance. Signed releases show a shield."
        />

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
            const allHealthy =
              healthyApplications.length === selectedApplications.length;

            return (
              <Card key={plugin.key}>
                <CardHeader>
                  <CardTitle>{plugin.name}</CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono text-xs">{plugin.key}</span>
                    <span aria-hidden="true">·</span>
                    <span>{runtimeLabel(profiles)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize">{plugin.visibility}</span>
                  </CardDescription>
                  <CardAction>
                    <Badge variant={plugin.is_active ? "success" : "warning"}>
                      {plugin.is_active ? "Active" : "Paused"}
                    </Badge>
                  </CardAction>
                </CardHeader>

                <CardContent className="@container">
                  <div className="grid gap-6 @md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                    <div className="grid min-w-0 content-start gap-3">
                      <h4 className="text-sm font-medium">Release channels</h4>
                      <RuntimeRows profiles={profiles} />
                    </div>

                    <div className="grid min-w-0 content-start gap-3">
                      <h4 className="text-sm font-medium">
                        Organization state
                      </h4>
                      <dl className="divide-y text-sm">
                        <div className="flex items-center justify-between gap-3 pb-2.5">
                          <dt>Installed</dt>
                          <dd className="font-medium tabular-nums">
                            {installs.length}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-3 py-2.5">
                          <dt>Using app</dt>
                          <dd className="font-medium tabular-nums">
                            {selectedApplications.length}
                          </dd>
                        </div>
                        {selectedApplications.length > 0 ? (
                          <div className="pt-2.5">
                            <Badge variant={allHealthy ? "success" : "warning"}>
                              {allHealthy
                                ? "Selected deployments are healthy"
                                : "Check the selected deployment"}
                            </Badge>
                          </div>
                        ) : null}
                      </dl>
                    </div>
                  </div>
                </CardContent>

                <CardFooter className="mt-auto flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-muted-foreground text-sm">
                    Catalog v{plugin.latest_version}
                    {plugin.force_update_version
                      ? ` · security floor v${plugin.force_update_version}`
                      : " · manual updates"}
                  </p>
                  <div className="flex shrink-0 justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onOpenAccess(plugin.key)}
                    >
                      Access
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onEditPlugin(plugin.key)}
                    >
                      Edit details
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
