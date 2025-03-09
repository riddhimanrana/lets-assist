// BasicInfo Component - Handles the basic information step

"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { useState } from "react";
import { RichTextContent } from "@/components/ui/rich-text-content";

interface BasicInfoProps {
  state: {
    basicInfo: {
      title: string;
      location: string;
      description: string;
    };
  };
  updateBasicInfoAction: (
    field: keyof BasicInfoProps["state"]["basicInfo"],
    value: string,
  ) => void;
  onMapClickAction: () => void;
}

export default function BasicInfo({
  state,
  updateBasicInfoAction,
  onMapClickAction,
}: BasicInfoProps) {
  const [previewMode, setPreviewMode] = useState(false);

  const getCounterColor = (current: number, max: number) => {
    const percentage = (current / max) * 100;
    if (percentage >= 90) return "text-destructive";
    if (percentage >= 75) return "text-chart-6";
    return "text-muted-foreground";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Basic Information</CardTitle>
        <p className="text-sm text-muted-foreground">
          Let&apos;s start with the essential details of your project
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between items-baseline">
            <Label htmlFor="title">Project Title</Label>
            <span
              className={cn(
                "text-xs transition-colors",
                getCounterColor(state.basicInfo.title.length, 75),
              )}
            >
              {state.basicInfo.title.length}/75
            </span>
          </div>
          <Input
            id="title"
            placeholder="e.g., Santa Cruz Beach Cleanup"
            value={state.basicInfo.title}
            onChange={(e) => {
              if (e.target.value.length <= 75) {
                updateBasicInfoAction("title", e.target.value);
              }
            }}
            maxLength={75}
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-baseline">
            <Label htmlFor="location">Location</Label>
            <span
              className={cn(
                "text-xs transition-colors",
                getCounterColor(state.basicInfo.location.length, 200),
              )}
            >
              {state.basicInfo.location.length}/200
            </span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              id="location"
              placeholder="e.g., Room 3201, Riverside Community Center"
              value={state.basicInfo.location}
              onChange={(e) => {
                if (e.target.value.length <= 200) {
                  updateBasicInfoAction("location", e.target.value);
                }
              }}
              maxLength={200}
            />
            <Button variant="outline" type="button" onClick={onMapClickAction}>
              <MapPin className="h-4 w-4 mr-2" />
              Map
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-baseline">
            <Label htmlFor="description">Description</Label>
            <div className="space-x-2">
              <Button type="button" variant={previewMode ? "outline" : "default"} size="sm" onClick={() => setPreviewMode(false)}>
                Edit
              </Button>
              <Button type="button" variant={!previewMode ? "outline" : "default"} size="sm" onClick={() => setPreviewMode(true)}>
                Preview
              </Button>
            </div>
          </div>
          {previewMode ? (
            <div className="rounded-md border bg-background p-4 shadow-sm">
              <RichTextContent content={state.basicInfo.description} />
            </div>
          ) : (
            <RichTextEditor
              content={state.basicInfo.description}
              onChange={(html) => updateBasicInfoAction("description", html)}
              maxLength={1000}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
