"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { SettingsSection } from "@/components/layout/SettingsSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  const [saveState, saveAction, savePending] = useActionState(
    saveSystemBanner,
    INITIAL_STATE,
  );
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
  }, [
    deactivateState.error,
    deactivateState.message,
    deactivateState.success,
    router,
  ]);

  const deactivateFormId = `${scope}-deactivate`;
  const scopeName = isLandingScope ? "landing" : "sitewide";
  const savedTypeLabel =
    typeOptions.find((option) => option.value === banner?.banner_type)?.label ??
    "";
  const set = <K extends keyof BannerFormValues>(
    key: K,
    value: BannerFormValues[K],
  ) => setFormValues((prev) => ({ ...prev, [key]: value }));

  return (
    <>
      <form id={deactivateFormId} action={deactivateAction}>
        <input type="hidden" name="targetScope" value={scope} />
      </form>

      <form action={saveAction}>
        <SettingsSection
          title={isLandingScope ? "Landing-only banner" : "Sitewide banner"}
          description={
            isLandingScope
              ? "Shown only on the public landing page (/)."
              : "Shown across the website unless a landing-specific banner overrides it on /."
          }
          status={
            banner?.is_active ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Inactive
              </Badge>
            )
          }
          footerHint={`Saving this banner as active replaces any other active ${scopeName} banner.`}
          footer={
            <>
              <Button
                type="submit"
                form={deactivateFormId}
                variant="outline"
                disabled={deactivatePending}
              >
                {deactivatePending ? "Deactivating..." : "Deactivate"}
              </Button>
              <Button type="submit" disabled={savePending}>
                {savePending ? "Saving..." : `Save ${scopeName} banner`}
              </Button>
            </>
          }
        >
          <p className="text-muted-foreground text-sm">
            {banner
              ? `Last updated ${new Date(banner.updated_at).toLocaleString()} · ${savedTypeLabel}`
              : "No banner configured for this scope yet."}
          </p>

          <input type="hidden" name="targetScope" value={scope} />
          <input type="hidden" name="bannerId" value={banner?.id ?? ""} />
          <input
            type="hidden"
            name="bannerType"
            value={formValues.bannerType}
          />
          <input
            type="hidden"
            name="startsAt"
            value={formValues.startsAt?.toISOString() ?? ""}
          />
          <input
            type="hidden"
            name="endsAt"
            value={formValues.endsAt?.toISOString() ?? ""}
          />
          <input
            type="hidden"
            name="isActive"
            value={String(formValues.isActive)}
          />
          <input
            type="hidden"
            name="dismissible"
            value={String(formValues.dismissible)}
          />
          <input
            type="hidden"
            name="showIcon"
            value={String(formValues.showIcon)}
          />
          <input type="hidden" name="textAlign" value={formValues.textAlign} />

          <FieldGroup className="gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${scope}-type`}>Banner type</FieldLabel>
                <Select
                  items={typeOptions}
                  value={formValues.bannerType}
                  onValueChange={(value) =>
                    set("bannerType", value as SystemBannerType)
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
              </Field>

              <Field>
                <FieldLabel htmlFor={`${scope}-text-align`}>
                  Text alignment
                </FieldLabel>
                <Select
                  items={textAlignOptions}
                  value={formValues.textAlign}
                  onValueChange={(value) =>
                    set("textAlign", value as SystemBannerTextAlign)
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
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor={`${scope}-title`}>
                Title (optional)
              </FieldLabel>
              <Input
                id={`${scope}-title`}
                name="title"
                placeholder="Planned maintenance"
                maxLength={120}
                value={formValues.title}
                onChange={(event) => set("title", event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor={`${scope}-message`}>Message</FieldLabel>
              <Textarea
                id={`${scope}-message`}
                name="message"
                placeholder="We are currently investigating elevated error rates."
                maxLength={1000}
                required
                value={formValues.message}
                onChange={(event) => set("message", event.target.value)}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${scope}-startsAt`}>
                  Start date (optional)
                </FieldLabel>
                <DateTimePicker
                  value={formValues.startsAt}
                  onChange={(date) => set("startsAt", date)}
                  placeholder="Set start date/time"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor={`${scope}-endsAt`}>
                  End date (optional)
                </FieldLabel>
                <DateTimePicker
                  value={formValues.endsAt}
                  onChange={(date) => set("endsAt", date)}
                  placeholder="Set end date/time"
                />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${scope}-ctaLabel`}>
                  CTA label (optional)
                </FieldLabel>
                <Input
                  id={`${scope}-ctaLabel`}
                  name="ctaLabel"
                  placeholder="View status page"
                  maxLength={40}
                  value={formValues.ctaLabel}
                  onChange={(event) => set("ctaLabel", event.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor={`${scope}-ctaUrl`}>
                  CTA URL (optional)
                </FieldLabel>
                <Input
                  id={`${scope}-ctaUrl`}
                  name="ctaUrl"
                  placeholder="/status"
                  maxLength={255}
                  value={formValues.ctaUrl}
                  onChange={(event) => set("ctaUrl", event.target.value)}
                />
                <FieldDescription>
                  A path such as /status, or a full URL.
                </FieldDescription>
              </Field>
            </div>

            <div className="grid gap-1">
              <CheckboxRow
                id={`${scope}-isActive`}
                label="Active (show banner)"
                checked={formValues.isActive}
                onCheckedChange={(checked) => set("isActive", checked)}
              />
              <CheckboxRow
                id={`${scope}-dismissible`}
                label="Allow users to dismiss"
                checked={formValues.dismissible}
                onCheckedChange={(checked) => set("dismissible", checked)}
              />
              <CheckboxRow
                id={`${scope}-showIcon`}
                label="Show status icon"
                checked={formValues.showIcon}
                onCheckedChange={(checked) => set("showIcon", checked)}
              />
            </div>
          </FieldGroup>
        </SettingsSection>
      </form>
    </>
  );
}

function CheckboxRow({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Field orientation="horizontal" className="min-h-9">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <FieldLabel htmlFor={id} className="font-normal">
        {label}
      </FieldLabel>
    </Field>
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
    <div className="grid gap-6">
      <BannerScopeForm scope="sitewide" banner={sitewideBanner} />
      <BannerScopeForm scope="landing" banner={landingBanner} />
    </div>
  );
}
