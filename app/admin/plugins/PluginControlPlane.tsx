"use client";

import { useState } from "react";

import { KeyIcon, useAnimatedIcon } from "@/components/icons/animated";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PluginControlPlaneData } from "./actions";
import PluginAccessControls from "./PluginAccessControls";
import PluginAdvancedControls from "./PluginAdvancedControls";
import PluginDataBoundaries from "./PluginDataBoundaries";
import PluginDetails from "./PluginDetails";
import PluginOverview from "./PluginOverview";

type PluginControlPlaneProps = { data: PluginControlPlaneData };

export default function PluginControlPlane({ data }: PluginControlPlaneProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedPluginKey, setSelectedPluginKey] = useState(
    data.plugins[0]?.key ?? "",
  );
  const grantIcon = useAnimatedIcon();

  const openTab = (tab: string, pluginKey?: string) => {
    if (pluginKey) setSelectedPluginKey(pluginKey);
    setActiveTab(tab);
  };

  return (
    <>
      <PageHeader
        title="Plugins"
        description="Manage access, installed versions, runtimes, and deployment health."
        actions={
          // Every other tab carries its own save action, so the page-level
          // primary only shows where nothing else competes with it.
          activeTab === "overview" ? (
            <Button
              type="button"
              onClick={() => openTab("access")}
              {...grantIcon.triggerProps}
            >
              <KeyIcon
                ref={grantIcon.ref}
                size={16}
                aria-hidden="true"
                data-icon="inline-start"
              />
              Grant access
            </Button>
          ) : null
        }
      />

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="w-full gap-6"
      >
        <TabsList variant="line" className="border-b">
          <TabsTrigger value="overview" className="flex-none">
            Overview
          </TabsTrigger>
          <TabsTrigger value="access" className="flex-none">
            Organization access
          </TabsTrigger>
          <TabsTrigger value="data" className="flex-none">
            Data
          </TabsTrigger>
          <TabsTrigger value="details" className="flex-none">
            Plugin details
          </TabsTrigger>
          <TabsTrigger value="advanced" className="flex-none">
            Advanced
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0">
          <PluginOverview
            data={data}
            onEditPlugin={(pluginKey) => openTab("details", pluginKey)}
            onOpenAccess={(pluginKey) => openTab("access", pluginKey)}
          />
        </TabsContent>
        <TabsContent value="access" className="mt-0">
          <PluginAccessControls
            data={data}
            selectedPluginKey={selectedPluginKey}
          />
        </TabsContent>
        <TabsContent value="data" className="mt-0">
          <PluginDataBoundaries data={data} />
        </TabsContent>
        <TabsContent value="details" className="mt-0">
          <PluginDetails data={data} selectedPluginKey={selectedPluginKey} />
        </TabsContent>
        <TabsContent value="advanced" className="mt-0">
          <PluginAdvancedControls
            data={data}
            selectedPluginKey={selectedPluginKey}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
