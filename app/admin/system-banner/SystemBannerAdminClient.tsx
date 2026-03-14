"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Globe, Home } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  SystemBanner,
  SystemBannerScope,
  SystemBannerTextAlign,
  SystemBannerType,
} from "@/types/system-banner";
import { deactivateSystemBannerScope, saveSystemBanner } from "./actions";

type BannerScopeFormProps = {
  scope: SystemBannerScope;
  banner: SystemBanner | null;
};

type ActionState = {
  success: boolean;
  error?: string;
  message?: string;
};

const INITIAL_STATE: ActionState = { success: false };

const typeOptions: Array<{
  value: SystemBannerType;
  label: string;
}> = [
  { value: "info", label: "Info" },
  { value: "success", label: "Success" },
  { value: "warning", label: "Warning" },
  { value: "outage", label: "Outage" },
];

const textAlignOptions: Array<{
  value: SystemBannerTextAlign;
  label: string;
}> = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

type BannerFormValues = {
  bannerType: SystemBannerType;
  title: string;
  message: string;
  startsAt: Date | null;
  endsAt: Date | null;
  ctaLabel: string;
  ctaUrl: string;
  isActive: boolean;
  dismissible: boolean;
  showIcon: boolean;
  textAlign: SystemBannerTextAlign;
};

const parseIsoDate = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const buildInitialValues = (banner: SystemBanner | null): BannerFormValues => {
  return {
    bannerType: banner?.banner_type ?? "info",
    title: banner?.title ?? "",
    message: banner?.message ?? "",
    startsAt: parseIsoDate(banner?.starts_at ?? null),
    endsAt: parseIsoDate(banner?.ends_at ?? null),
    ctaLabel: banner?.cta_label ?? "",
    ctaUrl: banner?.cta_url ?? "",
    isActive: banner?.is_active ?? false,
    dismissible: banner?.dismissible ?? false,
    showIcon: banner?.show_icon ?? true,
    textAlign: banner?.text_align ?? "center",
  };
};

function BannerScopeForm({ scope, banner }: BannerScopeFormProps) {
  const router = useRouter();
  const initialValues = useMemo(() => buildInitialValues(banner), [banner]);
  const [formValues, setFormValues] = useState<BannerFormValues>(initialValues);
  const [saveState, saveAction, savePending] = useActionState(saveSystemBanner, INITIAL_STATE);
  const [deactivateState, deactivateAction, deactivatePending] = useActionState(
    deactivateSystemBannerScope,
    INITIAL_STATE,
  );

  const isLandingScope = scope === "landing";

  useEffect(() => {
    setFormValues(initialValues);
  }, [initialValues]);

  useEffect(() => {
    if (saveState.success) {
      toast.success(saveState.message || "Banner saved.");
      router.refresh();
      return;
    }

    if (saveState.error) {
      toast.error(saveState.error);
    }
  }, [router, saveState.error, saveState.message, saveState.success]);

  useEffect(() => {
    if (deactivateState.success) {
      toast.success(deactivateState.message || "Banner deactivated.");
      router.refresh();
      return;
    }

    if (deactivateState.error) {
      toast.error(deactivateState.error);
    }
  }, [deactivateState.error, deactivateState.message, deactivateState.success, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          {isLandingScope ? <Home className="h-5 w-5" /> : <Globe className="h-5 w-5" />}
          {isLandingScope ? "Landing-only banner" : "Sitewide banner"}
        </CardTitle>
        <CardDescription>
          {isLandingScope
            ? "Shown only on the public landing page (/)."
            : "Shown across the website unless a landing-specific banner overrides it on /."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-lg border bg-muted/20 p-4 text-sm">
          <p className="font-medium">
            Current status: {banner?.is_active ? "Active" : "Inactive"}
          </p>
          {banner ? (
            <p className="mt-2 text-muted-foreground">
              Last updated {new Date(banner.updated_at).toLocaleString()} • Type: {banner.banner_type}
            </p>
          ) : (
            <p className="mt-2 text-muted-foreground">No banner configured for this scope yet.</p>
          )}
        </div>

        <form action={saveAction} className="space-y-4">
          <input type="hidden" name="targetScope" value={scope} />
          <input type="hidden" name="bannerId" value={banner?.id ?? ""} />
          <input type="hidden" name="bannerType" value={formValues.bannerType} />
          <input type="hidden" name="startsAt" value={formValues.startsAt?.toISOString() ?? ""} />
          <input type="hidden" name="endsAt" value={formValues.endsAt?.toISOString() ?? ""} />
          <input type="hidden" name="isActive" value={String(formValues.isActive)} />
          <input type="hidden" name="dismissible" value={String(formValues.dismissible)} />
          <input type="hidden" name="showIcon" value={String(formValues.showIcon)} />
          <input type="hidden" name="textAlign" value={formValues.textAlign} />

          <div className="grid gap-2">
            <Label htmlFor={`${scope}-type`}>Banner type</Label>
            <Select
              value={formValues.bannerType}
              onValueChange={(value) =>
                setFormValues((prev) => ({
                  ...prev,
                  bannerType: value as SystemBannerType,
                }))
              }
            >
              <SelectTrigger id={`${scope}-type`} className="w-full">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${scope}-title`}>Title (optional)</Label>
            <Input
              id={`${scope}-title`}
              name="title"
              placeholder="Planned maintenance"
              maxLength={120}
              value={formValues.title}
              onChange={(event) =>
                setFormValues((prev) => ({
                  ...prev,
                  title: event.target.value,
                }))
              }
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${scope}-message`}>Message</Label>
            <Textarea
              id={`${scope}-message`}
              name="message"
              placeholder="We are currently investigating elevated error rates."
              maxLength={1000}
              required
              value={formValues.message}
              onChange={(event) =>
                setFormValues((prev) => ({
                  ...prev,
                  message: event.target.value,
                }))
              }
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={`${scope}-startsAt`}>Start date (optional)</Label>
              <DateTimePicker
                value={formValues.startsAt}
                onChange={(date) =>
                  setFormValues((prev) => ({
                    ...prev,
                    startsAt: date,
                  }))
                }
                placeholder="Set start date/time"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`${scope}-endsAt`}>End date (optional)</Label>
              <DateTimePicker
                value={formValues.endsAt}
                onChange={(date) =>
                  setFormValues((prev) => ({
                    ...prev,
                    endsAt: date,
                  }))
                }
                placeholder="Set end date/time"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={`${scope}-ctaLabel`}>CTA label (optional)</Label>
              <Input
                id={`${scope}-ctaLabel`}
                name="ctaLabel"
                placeholder="View status page"
                maxLength={40}
                value={formValues.ctaLabel}
                onChange={(event) =>
                  setFormValues((prev) => ({
                    ...prev,
                    ctaLabel: event.target.value,
                  }))
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`${scope}-ctaUrl`}>CTA URL (optional)</Label>
              <Input
                id={`${scope}-ctaUrl`}
                name="ctaUrl"
                placeholder="/status or https://status.example.com"
                maxLength={255}
                value={formValues.ctaUrl}
                onChange={(event) =>
                  setFormValues((prev) => ({
                    ...prev,
                    ctaUrl: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div className="grid gap-4 rounded-md border p-3 md:grid-cols-2">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={formValues.isActive}
                onCheckedChange={(checked) =>
                  setFormValues((prev) => ({
                    ...prev,
                    isActive: checked === true,
                  }))
                }
              />
              Active (show banner)
            </label>

            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={formValues.dismissible}
                onCheckedChange={(checked) =>
                  setFormValues((prev) => ({
                    ...prev,
                    dismissible: checked === true,
                  }))
                }
              />
              Allow users to dismiss
            </label>

            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={formValues.showIcon}
                onCheckedChange={(checked) =>
                  setFormValues((prev) => ({
                    ...prev,
                    showIcon: checked === true,
                  }))
                }
              />
              Show status icon
            </label>

            <div className="grid gap-2">
              <Label htmlFor={`${scope}-text-align`}>Text alignment</Label>
              <Select
                value={formValues.textAlign}
                onValueChange={(value) =>
                  setFormValues((prev) => ({
                    ...prev,
                    textAlign: value as SystemBannerTextAlign,
                  }))
                }
              >
                <SelectTrigger id={`${scope}-text-align`} className="w-full">
                  <SelectValue placeholder="Select alignment" />
                </SelectTrigger>
                <SelectContent>
                  {textAlignOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={savePending}>
              {savePending ? "Saving..." : "Save banner"}
            </Button>

            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Only one active banner per scope is allowed. Activating this one auto-disables other active banners in the same scope.
            </span>
          </div>
        </form>

        <form action={deactivateAction}>
          <input type="hidden" name="targetScope" value={scope} />
          <Button type="submit" variant="outline" disabled={deactivatePending}>
            {deactivatePending ? "Deactivating..." : "Deactivate current active banner"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

type SystemBannerAdminClientProps = {
  sitewideBanner: SystemBanner | null;
  landingBanner: SystemBanner | null;
};

export function SystemBannerAdminClient({
  sitewideBanner,
  landingBanner,
}: SystemBannerAdminClientProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <BannerScopeForm scope="sitewide" banner={sitewideBanner} />
      <BannerScopeForm scope="landing" banner={landingBanner} />
    </div>
  );
}
