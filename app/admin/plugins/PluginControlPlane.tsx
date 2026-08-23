"use client";

import { useState } from "react";

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

  const openTab = (tab: string, pluginKey?: string) => {
    if (pluginKey) setSelectedPluginKey(pluginKey);
    setActiveTab(tab);
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className="w-full gap-4"
    >
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="access">Organization access</TabsTrigger>
        <TabsTrigger value="data">Data</TabsTrigger>
        <TabsTrigger value="details">Plugin details</TabsTrigger>
        <TabsTrigger value="advanced">Advanced</TabsTrigger>
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
  );
}
