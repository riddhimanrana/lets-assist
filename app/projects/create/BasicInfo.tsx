"use client";

import { useEffect, useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown, Building2, User, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { COMMON_TIMEZONES, getUserTimezone, getBestMatchingTimezone } from "@/utils/timezone";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface OrganizationOption {
  id: string;
  name: string;
  logo_url?: string | null;
  role: string;
}

interface BasicInfoProps {
  state: EventFormState;
  updateBasicInfoAction: (field: keyof EventFormState["basicInfo"], value: any) => void;
  initialOrgId?: string;
  initialOrganizations?: OrganizationOption[];
  errors?: {
    title?: string;
    location?: string;
    description?: string;
  };
}

export default function BasicInfo({ 
  state, 
  updateBasicInfoAction, 
  initialOrgId,
  initialOrganizations = [],
  errors = {}
}: BasicInfoProps) {
  const [open, setOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [organizationOptions, setOrganizationOptions] = useState<OrganizationOption[]>(
    initialOrganizations.length > 0 
      ? initialOrganizations 
      : [{ id: "personal", name: "Personal Project", logo_url: null, role: "creator" }]
  );
  const initRef = useRef(false);
  
  // Set default organization and timezone on initial render only
  useEffect(() => {
    if (initRef.current) return;
    
    initRef.current = true;
    
    // If initialOrgId is provided, use it
    if (initialOrgId && state.basicInfo.organizationId !== initialOrgId) {
      updateBasicInfoAction('organizationId', initialOrgId);
    } else if (state.basicInfo.organizationId === undefined) {
      // Otherwise, if no organization is set, default to personal (null)
      updateBasicInfoAction('organizationId', null);
    }
    
    // Initialize timezone to user's current timezone if not set
    if (!state.basicInfo.projectTimezone) {
      const detectedTimezone = getUserTimezone();
      const bestMatch = getBestMatchingTimezone(detectedTimezone);
      updateBasicInfoAction('projectTimezone', bestMatch);
    }
  }, []);

  // Find the selected organization or use personal project as default
  const selectedOrg = state.basicInfo.organizationId === null
    ? organizationOptions.find(org => org.id === "personal")
    : state.basicInfo.organizationId
      ? organizationOptions.find(org => org.id === state.basicInfo.organizationId)
      : organizationOptions.find(org => org.id === "personal");

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
    if (percentage >= 75) return "text-chart-6";
    return "text-muted-foreground";
  };

  // Helper function to render organization avatar consistently
  const renderOrgAvatar = (org: OrganizationOption) => {
    const iconSize = "h-3 w-3";
    const avatarSize = "h-6 w-6";

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Basic Information</CardTitle>
        <p className="text-sm text-muted-foreground">
          Let&apos;s start with some basic details about your project.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Organization Selection Combobox */}
        {organizationOptions.length > 1 && (
          <div className="space-y-2">
            <Label>Create Project As</Label>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={open}
                  className="w-full justify-between"
                >
                  {selectedOrg ? (
                    <div className="flex items-center gap-2">
                      {renderOrgAvatar(selectedOrg)}
                      <span>{selectedOrg.name}</span>
                    </div>
                  ) : (
                    "Select who's creating this project..."
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-0" align="start">
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
                              <span className="ml-1 text-xs text-muted-foreground">
                                ({org.role})
                              </span>
                            )}
                          </div>
                          <Check
                            className={cn(
                              "ml-auto h-4 w-4",
                              ((org.id === state.basicInfo.organizationId) ||
                               (state.basicInfo.organizationId === null && org.id === "personal"))
                                ? "opacity-100"
                                : "opacity-0"
                            )}
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              Choose whether to create this project personally or on behalf of an organization
            </p>
          </div>
        )}

        {/* Project Title */}
        <div className="space-y-2">
          <div className="flex justify-between items-baseline">
            <Label htmlFor="title">Project Title</Label>
            <span
              className={cn(
                "text-xs transition-colors",
                getCounterColor(state.basicInfo.title?.length || 0, 125)
              )}
            >
              {state.basicInfo.title?.length || 0}/125
            </span>
          </div>
          <Input
            id="title"
            placeholder="e.g., Santa Cruz Beach Cleanup"
            value={state.basicInfo.title ?? ''} // Ensure value is never undefined
            onChange={(e) => {
              if (e.target.value.length <= 125) {
                updateBasicInfoAction("title", e.target.value);
              }
            }}
            maxLength={125}
            required
            className={errors.title ? "border-destructive" : ""}
            aria-invalid={!!errors.title}
            aria-errormessage={errors.title ? "title-error" : undefined}
          />
          {errors.title && (
            <div id="title-error" className="text-destructive text-sm flex items-center gap-2 mt-1">
              <AlertCircle className="h-4 w-4" />
              {errors.title}
            </div>
          )}
        </div>

        {/* Project Location - Simplified */}
        <div className="space-y-2">
          <Label htmlFor="location">Project Location</Label> {/* Added external Label */} 
          <LocationAutocomplete 
            id="location" // Pass id
            value={state.basicInfo.locationData}
            onChangeAction={handleLocationChange}
            maxLength={250}
            required
            error={!!errors.location} // Pass boolean error state
            errorMessage={errors.location} // Pass error message
            aria-invalid={!!errors.location} // Pass aria-invalid
            aria-errormessage={errors.location ? "location-error" : undefined} // Pass aria-errormessage
          />
        </div>

        {/* Project Timezone */}
        <div className="space-y-2">
          <Label htmlFor="timezone">Project Timezone</Label>
          <p className="text-sm text-muted-foreground">
            Select the timezone where your project takes place. Event times will be displayed in this timezone with a badge (e.g., PST, EST) to help volunteers in other regions.
          </p>
          <Select
            value={state.basicInfo.projectTimezone || ''}
            onValueChange={(value) =>
              updateBasicInfoAction('projectTimezone', value)
            }
          >
            <SelectTrigger id="timezone">
              <SelectValue placeholder="Select project timezone" />
            </SelectTrigger>
            <SelectContent>
              {COMMON_TIMEZONES.map((timezone) => (
                <SelectItem key={timezone.value} value={timezone.value}>
                  {timezone.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Project Description */}
        <div className="space-y-2">
          <div className="flex justify-between items-baseline">
            <Label htmlFor="description">Description</Label>
            <div className="space-x-2">
              <Button 
                type="button" 
                variant={previewMode ? "outline" : "default"} 
                size="sm" 
                onClick={() => setPreviewMode(false)}
              >
                Edit
              </Button>
              <Button 
                type="button" 
                variant={!previewMode ? "outline" : "default"} 
                size="sm" 
                onClick={() => setPreviewMode(true)}
              >
                Preview
              </Button>
            </div>
          </div>
          
          {previewMode ? (
            <div className="rounded-md border text-sm bg-background p-4 shadow-sm">
              <RichTextContent content={state.basicInfo.description ?? ''} />
            </div>
          ) : (
            <div className="space-y-1">
              <RichTextEditor
                content={state.basicInfo.description ?? ''}
                onChange={(html) => updateBasicInfoAction("description", html)}
                maxLength={2000}
                className={errors.description ? "border-destructive" : ""}
              />
              {errors.description && (
                <div className="text-destructive text-sm flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {errors.description}
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
