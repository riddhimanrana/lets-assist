"use client";

import { Fragment, useState, useTransition } from "react";
import { StatStrip } from "@/components/layout/SettingsSection";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle,
  FileText,
  Image as ImageIcon,
  Info,
  User,
} from "lucide-react";
import { getOrgFlaggedContent } from "./actions";
import { format } from "date-fns";

type FlagStatus = "pending_review" | "blocked" | "confirmed" | "dismissed";

const isFlagStatus = (value: string): value is FlagStatus =>
  value === "pending_review" ||
  value === "blocked" ||
  value === "confirmed" ||
  value === "dismissed";

type FlaggedContent = {
  id: string;
  content_type: string;
  severity: string;
  created_at: string;
  reason?: string | null;
  categories?: Record<string, boolean | null> | null;
  profiles?: {
    full_name?: string | null;
    username?: string | null;
    email?: string | null;
  } | null;
};
type ModerationStats = {
  total: number;
  pending: number;
  blocked: number;
  critical: number;
  recentWeek: number;
};

export default function OrgModerationDashboard({
  organizationId,
  initialStats,
  initialFlagged,
}: {
  organizationId: string;
  initialStats: ModerationStats;
  initialFlagged: FlaggedContent[];
}) {
  const [stats] = useState(initialStats);
  const [flaggedContent, setFlaggedContent] = useState(initialFlagged);
  const [selectedTab, setSelectedTab] = useState<FlagStatus>("pending_review");
  const [isPending, startTransition] = useTransition();

  const loadFlaggedContent = async (status: FlagStatus) => {
    startTransition(async () => {
      const result = await getOrgFlaggedContent(organizationId, status);
      if (result.data) {
        setFlaggedContent(result.data);
      }
    });
  };

  const getSeverityColor = (
    severity: string,
  ): "secondary" | "destructive" | "default" => {
    switch (severity) {
      case "critical":
      case "high":
        return "destructive";
      case "medium":
        return "default";
      default:
        return "secondary";
    }
  };

  return (
    <div className="grid gap-6">
      <StatStrip
        items={[
          { label: "Total flagged", value: stats.total, helper: "All time" },
          {
            label: "Pending review",
            value: stats.pending,
            helper: "Needs attention",
          },
          {
            label: "Critical issues",
            value: stats.critical,
            helper: "High or critical severity",
          },
          {
            label: "This week",
            value: stats.recentWeek,
            helper: "Last 7 days",
          },
        ]}
      />

      <Alert variant="info">
        <Info />
        <AlertDescription>
          Only platform administrators can take action on flagged content. This
          page is for monitoring and reporting.
        </AlertDescription>
      </Alert>

      <Tabs
        className="gap-4"
        value={selectedTab}
        onValueChange={(v) => {
          if (!isFlagStatus(v)) return;
          setSelectedTab(v);
          loadFlaggedContent(v);
        }}
      >
        <TabsList variant="line" className="border-b">
          <TabsTrigger value="pending_review" className="flex-none">
            Pending ({stats.pending})
          </TabsTrigger>
          <TabsTrigger value="blocked" className="flex-none">
            Blocked ({stats.blocked})
          </TabsTrigger>
          <TabsTrigger value="confirmed" className="flex-none">
            Confirmed
          </TabsTrigger>
          <TabsTrigger value="dismissed" className="flex-none">
            Dismissed
          </TabsTrigger>
        </TabsList>

        <TabsContent value={selectedTab}>
          {isPending ? (
            <Card className="py-0">
              <div className="grid gap-4 p-4">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex items-start gap-3">
                    <Skeleton className="size-8 rounded-md" />
                    <div className="grid flex-1 gap-2">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-4 w-full max-w-md" />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : flaggedContent.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CheckCircle />
                </EmptyMedia>
                <EmptyTitle>No items found</EmptyTitle>
                <EmptyDescription>
                  There are no flagged items with this status.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Card className="py-0">
              <ItemGroup className="gap-0">
                {flaggedContent.map((item, index) => {
                  const categories = Object.entries(item.categories ?? {})
                    .filter(([, value]) => value)
                    .map(([key]) => key);
                  const author =
                    item.profiles?.full_name ||
                    item.profiles?.username ||
                    item.profiles?.email;

                  return (
                    <Fragment key={item.id}>
                      {index > 0 ? <ItemSeparator className="my-0" /> : null}
                      <Item className="items-start rounded-none">
                        <ItemMedia variant="icon">
                          {item.content_type === "image" ? (
                            <ImageIcon />
                          ) : (
                            <FileText />
                          )}
                        </ItemMedia>
                        <ItemContent className="min-w-0 gap-2">
                          <ItemTitle className="flex-wrap">
                            {item.content_type === "image"
                              ? "Image content"
                              : "Text content"}
                            <Badge
                              variant={getSeverityColor(item.severity)}
                              className="capitalize"
                            >
                              {item.severity}
                            </Badge>
                          </ItemTitle>
                          {item.reason ? (
                            <ItemDescription className="line-clamp-none">
                              <span className="text-foreground font-medium">
                                Flagged for:
                              </span>{" "}
                              {item.reason}
                            </ItemDescription>
                          ) : null}
                          {categories.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {categories.map((key) => (
                                <Badge key={key} variant="outline">
                                  {key.replace("_", " ")}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                            {author ? (
                              <span className="flex items-center gap-1.5">
                                <User className="size-4" />
                                {author}
                              </span>
                            ) : null}
                            <span>
                              {format(new Date(item.created_at), "PPp")}
                            </span>
                          </div>
                        </ItemContent>
                      </Item>
                    </Fragment>
                  );
                })}
              </ItemGroup>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
