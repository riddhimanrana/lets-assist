"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { SendIcon, useAnimatedIcon } from "@/components/icons/animated";
import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsSection } from "@/components/layout/SettingsSection";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { sendSystemNotification } from "../actions";
import { AdminPage } from "../components/AdminPage";
import { UserSearch } from "./components/UserSearch";

const SEVERITIES = [
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "success", label: "Success" },
] as const;

const initialState = {
  error: "",
  success: false,
  message: "",
};

export default function AdminNotificationsPage() {
  // Mode: 'broadcast' (all), 'specific' (one user)
  const [mode, setMode] = useState<"broadcast" | "specific">("broadcast");
  const [selectedUserId, setSelectedUserId] = useState("");
  const sendIcon = useAnimatedIcon();

  const [, formAction, isPending] = useActionState(
    async (
      prev: { error?: string; success?: boolean; message?: string } | null,
      formData: FormData,
    ) => {
      // Enforce validations client/state side before submit if needed or let action handle it
      if (mode === "specific" && !selectedUserId) {
        toast.error("Please select a user");
        return { error: "Please select a user", success: false, message: "" };
      }

      const result = await sendSystemNotification(prev, formData);
      if (result.success) {
        toast.success(result.message);
      } else if (result.error) {
        toast.error(result.error);
      }
      return result;
    },
    initialState,
  );

  return (
    <AdminPage width="form">
      <PageHeader title="Notifications" />
      <form action={formAction}>
        <SettingsSection
          title="Send system notification"
          description="Send a notification to a specific user or broadcast to everyone."
          footer={
            <Button
              type="submit"
              disabled={isPending}
              className="w-full sm:w-auto"
              {...sendIcon.triggerProps}
            >
              {isPending ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <SendIcon
                  ref={sendIcon.ref}
                  size={16}
                  aria-hidden="true"
                  data-icon="inline-start"
                />
              )}
              Send notification
            </Button>
          }
        >
          <FieldGroup className="gap-6">
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="broadcast-mode">
                  Broadcast to all users
                </FieldLabel>
                <FieldDescription>
                  Turn off to send to one specific user.
                </FieldDescription>
              </FieldContent>
              <Switch
                id="broadcast-mode"
                checked={mode === "broadcast"}
                onCheckedChange={(checked) => {
                  setMode(checked ? "broadcast" : "specific");
                  if (checked) setSelectedUserId("all");
                  else setSelectedUserId("");
                }}
              />
            </Field>

            {mode === "specific" && (
              <Field>
                <FieldLabel>Search user</FieldLabel>
                <UserSearch
                  onSelect={(id) => setSelectedUserId(id)}
                  selectedUserId={selectedUserId}
                />
              </Field>
            )}

            {/* Hidden input for form submission */}
            <input
              type="hidden"
              name="targetUserId"
              value={mode === "broadcast" ? "all" : selectedUserId}
            />

            <FieldSet>
              <FieldLegend variant="label">Severity</FieldLegend>
              <RadioGroup
                defaultValue="info"
                name="severity"
                className="flex flex-wrap gap-x-6 gap-y-1"
              >
                {SEVERITIES.map((severity) => (
                  <Field
                    key={severity.value}
                    orientation="horizontal"
                    className="min-h-9 w-auto"
                  >
                    <RadioGroupItem
                      value={severity.value}
                      id={`r-${severity.value}`}
                    />
                    <FieldLabel
                      htmlFor={`r-${severity.value}`}
                      className="font-normal"
                    >
                      {severity.label}
                    </FieldLabel>
                  </Field>
                ))}
              </RadioGroup>
            </FieldSet>

            <Field>
              <FieldLabel htmlFor="title">Title</FieldLabel>
              <Input
                id="title"
                name="title"
                placeholder="Notification title"
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="body">Message body</FieldLabel>
              <Textarea
                id="body"
                name="body"
                placeholder="Type your message here."
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="actionUrl">Action URL (optional)</FieldLabel>
              <Input id="actionUrl" name="actionUrl" placeholder="/dashboard" />
            </Field>
          </FieldGroup>
        </SettingsSection>
      </form>
    </AdminPage>
  );
}
