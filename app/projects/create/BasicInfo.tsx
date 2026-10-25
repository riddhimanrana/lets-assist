"use client";

import { useEffect, useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown, Building2, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FormField, FormGroup, StepSection } from "./form-parts";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EventFormState } from "@/hooks/use-event-form";
import LocationAutocomplete from "@/components/ui/location-autocomplete";
import { LocationData } from "@/types";
import {
  COMMON_TIMEZONES,
  getUserTimezone,
  getBestMatchingTimezone,
} from "@/utils/timezone";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PERSONAL_PROJECT_LABEL = "Personal project";

interface OrganizationOption {
  id: string;
  name: string;
  logo_url?: string | null;
  role: string;
}

interface BasicInfoProps {
  state: EventFormState;
  updateBasicInfoAction: (
    field: keyof EventFormState["basicInfo"],
    value: EventFormState["basicInfo"][keyof EventFormState["basicInfo"]],
  ) => void;
  initialOrganizations?: OrganizationOption[];
  showLocationPointer?: boolean;
  onLocationPointerDismiss?: () => void;
  errors?: {
    title?: string;
    location?: string;
    description?: string;
  };
}

export default function BasicInfo({
  state,
  updateBasicInfoAction,
  initialOrganizations = [],
  showLocationPointer,
  onLocationPointerDismiss,
  errors = {},
}: BasicInfoProps) {
  const [open, setOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [organizationOptions, _setOrganizationOptions] = useState<
    OrganizationOption[]
  >(
    initialOrganizations.length > 0
      ? // The route still sends its own label for the personal option.
        initialOrganizations.map((org) =>
          org.id === "personal"
            ? { ...org, name: PERSONAL_PROJECT_LABEL }
            : org,
        )
      : [
          {
            id: "personal",
            name: PERSONAL_PROJECT_LABEL,
            logo_url: null,
            role: "creator",
          },
        ],
  );
  const initRef = useRef(false);

  // Set a browser timezone only when the form does not already have one.
  useEffect(() => {
    if (initRef.current) return;

    initRef.current = true;

    // Initialize timezone to user's current timezone if not set
    if (!state.basicInfo.projectTimezone) {
      const detectedTimezone = getUserTimezone();
      const bestMatch = getBestMatchingTimezone(detectedTimezone);
      updateBasicInfoAction("projectTimezone", bestMatch);
    }
  }, []);

  // Find the selected organization or use personal project as default
  const selectedOrg =
    state.basicInfo.organizationId === null
      ? organizationOptions.find((org) => org.id === "personal")
      : state.basicInfo.organizationId
        ? organizationOptions.find(
            (org) => org.id === state.basicInfo.organizationId,
          )
        : organizationOptions.find((org) => org.id === "personal");

  // Handle selection
  const handleOrganizationSelect = (orgId: string) => {
    if (orgId === "personal") {
      updateBasicInfoAction("organizationId", null);
    } else {
      updateBasicInfoAction("organizationId", orgId);
    }
    setOpen(false);
  };

  // Update the location handler to save both location text and location data
  const handleLocationChange = (locationData?: LocationData) => {
    if (locationData) {
      updateBasicInfoAction("location", locationData.text);
      updateBasicInfoAction("locationData", locationData);
    } else {
      updateBasicInfoAction("location", "");
      updateBasicInfoAction("locationData", undefined);
    }
  };

  // Character count helpers
  const getCounterColor = (current: number, max: number) => {
    const percentage = (current / max) * 100;
    if (percentage >= 90) return "text-destructive";
    if (percentage >= 75) return "text-warning";
    return "text-muted-foreground";
  };

  // Helper function to render organization avatar consistently
  const renderOrgAvatar = (org: OrganizationOption) => {
    const iconSize = "size-3";
    const avatarSize = "size-6";

    return (
      <Avatar className={avatarSize}>
        {org.id === "personal" ? (
          <>
            <AvatarImage src={org.logo_url || undefined} alt={org.name} />
            <AvatarFallback className="bg-primary/10">
              <User className={`${iconSize} text-primary`} />
            </AvatarFallback>
          </>
        ) : (
          <>
            <AvatarImage src={org.logo_url || undefined} alt={org.name} />
            <AvatarFallback className="bg-primary/10">
              <Building2 className={`${iconSize} text-primary`} />
            </AvatarFallback>
          </>
        )}
      </Avatar>
    );
  };

  const titleLength = state.basicInfo.title?.length || 0;

  return (
    <StepSection
      title="Basic information"
      description="Let's start with some basic details about your project."
    >
      <FormGroup title="Details">
        {/* Organization Selection Combobox */}
        {organizationOptions.length > 1 && (
          <FormField
            label="Create project as"
            htmlFor="organization"
            description="Choose whether to create this project personally or on behalf of an organization"
          >
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger
                render={
                  <Button
                    id="organization"
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between"
                  >
                    {selectedOrg ? (
                      <span className="flex min-w-0 items-center gap-2">
                        {renderOrgAvatar(selectedOrg)}
                        <span className="truncate">{selectedOrg.name}</span>
                      </span>
                    ) : (
                      "Select who's creating this project..."
                    )}
                    <ChevronsUpDown
                      data-icon="inline-end"
                      aria-hidden="true"
                      className="opacity-50"
                    />
                  </Button>
                }
              />
              <PopoverContent className="w-75 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search organizations..." />
                  <CommandList>
                    <CommandEmpty>No organizations found.</CommandEmpty>
                    <CommandGroup>
                      {organizationOptions.map((org) => (
                        <CommandItem
                          key={org.id}
                          value={org.name}
                          onSelect={() => handleOrganizationSelect(org.id)}
                          className="flex items-center gap-2"
                        >
                          {renderOrgAvatar(org)}
                          <div className="flex-1">
                            <span>{org.name}</span>
                            {org.id !== "personal" && (
                              <span className="text-muted-foreground ml-1 text-xs">
                                ({org.role})
                              </span>
                            )}
                          </div>
                          <Check
                            aria-hidden="true"
                            className={cn(
                              "ml-auto size-4",
                              org.id === state.basicInfo.organizationId ||
                                (state.basicInfo.organizationId === null &&
                                  org.id === "personal")
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </FormField>
        )}

        {/* Project Title */}
        <FormField
          label="Project title"
          htmlFor="title"
          hint={
            <span
              className={cn(
                "text-xs tabular-nums transition-colors",
                getCounterColor(titleLength, 125),
              )}
            >
              {titleLength}/125
            </span>
          }
          error={errors.title}
          errorId="title-error"
        >
          <Input
            id="title"
            placeholder="e.g., Santa Cruz Beach Cleanup"
            value={state.basicInfo.title ?? ""} // Ensure value is never undefined
            onChange={(e) => {
              if (e.target.value.length <= 125) {
                updateBasicInfoAction("title", e.target.value);
              }
            }}
            maxLength={125}
            required
            aria-invalid={!!errors.title}
            aria-errormessage={errors.title ? "title-error" : undefined}
          />
        </FormField>
      </FormGroup>

      <FormGroup title="Location">
        {/* Project Location - Simplified */}
        <FormField label="Project location" htmlFor="location">
          <LocationAutocomplete
            id="location" // Pass id
            value={state.basicInfo.locationData}
            onChangeAction={(data) => {
              handleLocationChange(data);
              if (showLocationPointer && onLocationPointerDismiss) {
                onLocationPointerDismiss();
              }
            }}
            onFocusAction={() => {
              if (showLocationPointer && onLocationPointerDismiss) {
                onLocationPointerDismiss();
              }
            }}
            highlight={showLocationPointer}
            maxLength={250}
            required
            error={!!errors.location} // Pass boolean error state
            errorMessage={errors.location} // Pass error message
            aria-invalid={!!errors.location} // Pass aria-invalid
            aria-errormessage={errors.location ? "location-error" : undefined} // Pass aria-errormessage
          />
        </FormField>

        {/* Project Timezone */}
        <FormField
          label="Project timezone"
          htmlFor="timezone"
          description="Select the timezone where your project takes place. Event times will be displayed in this timezone with a badge (e.g., PST, EST) to help volunteers in other regions."
        >
          <Select
            value={state.basicInfo.projectTimezone || ""}
            onValueChange={(value) =>
              updateBasicInfoAction("projectTimezone", value)
            }
          >
            <SelectTrigger id="timezone" className="w-full">
              <SelectValue placeholder="Select project timezone">
                {state.basicInfo.projectTimezone
                  ? COMMON_TIMEZONES.find(
                      (tz) => tz.value === state.basicInfo.projectTimezone,
                    )?.label || state.basicInfo.projectTimezone
                  : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COMMON_TIMEZONES.map((timezone) => (
                <SelectItem key={timezone.value} value={timezone.value}>
                  {timezone.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </FormGroup>

      {/* Project Description */}
      <FormGroup>
        <Tabs
          value={previewMode ? "preview" : "edit"}
          onValueChange={(value) => setPreviewMode(value === "preview")}
          className="gap-3"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 id="description-heading" className="text-base font-medium">
              Description
            </h3>
            <TabsList>
              <TabsTrigger value="edit">Edit</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="edit">
            <FormField error={errors.description}>
              <RichTextEditor
                content={state.basicInfo.description ?? ""}
                onChange={(html) => updateBasicInfoAction("description", html)}
                maxLength={2000}
                className={errors.description ? "border-destructive" : ""}
              />
            </FormField>
          </TabsContent>
          <TabsContent value="preview">
            <div className="bg-background rounded-md border p-4 text-sm">
              <RichTextContent content={state.basicInfo.description ?? ""} />
            </div>
          </TabsContent>
        </Tabs>
      </FormGroup>
    </StepSection>
  );
}
