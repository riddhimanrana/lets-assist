"use client";

import { useState, useEffect, useCallback } from "react";
import { useEventForm } from "@/hooks/use-event-form";
import BasicInfo from "./BasicInfo";
import EventType from "./EventType";
import Schedule from "./Schedule";
import Finalize from "./Finalize";
import VerificationSettings from "./VerificationSettings";

// shadcn components
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";

// icon components
import { Loader2, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";

// utility
import { cn } from "@/lib/utils";

// Add these imports
import { createProject } from "./actions";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";

interface LocationResult {
  display_name: string;
}

export default function ProjectCreator() {
  const {
    state,
    nextStep,
    prevStep,
    setEventType,
    updateBasicInfo,
    addMultiDaySlot,
    addMultiDayEvent,
    addRole,
    updateOneTimeSchedule,
    updateMultiDaySchedule,
    updateMultiRoleSchedule,
    updateVerificationMethod,
    updateRequireLogin,
    removeDay,
    removeSlot,
    removeRole,
    canProceed,
  } = useEventForm();
  const { toast } = useToast();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Map Dialog state
  const [mapDialogOpen, setMapDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<LocationResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [userCoords, setUserCoords] = useState<{
    lat: number;
    lon: number;
  } | null>(null);

  // Request user location only when Map dialog is open
  useEffect(() => {
    if (mapDialogOpen && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserCoords({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
          });
        },
        (error) => {
          console.error("Error getting user location:", error);
        },
      );
    }
  }, [mapDialogOpen]);

  // Function to format location results (simplified)
  const formatLocation = (displayName: string) => {
    const parts = displayName.split(",").map((p) => p.trim());
    const title = parts[0] || "";
    const address = parts.slice(1, 4).join(", ");
    return (
      <div>
        <div className="font-medium">{title}</div>
        {address && (
          <div className="text-sm text-muted-foreground">{address}</div>
        )}
      </div>
    );
  };

  // Search function using userCoords if available
  const searchLocation = useCallback(async () => {
    if (!searchQuery) {
      setResults([]);
      return;
    }
    setIsLoading(true);
    try {
      const baseURL = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`;
      const url = userCoords
        ? `${baseURL}&viewbox=${userCoords.lon - 0.1},${userCoords.lat - 0.1},${userCoords.lon + 0.1},${userCoords.lat + 0.1}&bounded=1`
        : baseURL;
      const res = await fetch(url);
      const data = await res.json();
      setResults(data);
    } catch (error) {
      console.error("Error searching location:", error);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, userCoords]);

  // Debounce search on query change
  useEffect(() => {
    const timer = setTimeout(() => {
      searchLocation();
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery, searchLocation]);

  const handleSelectLocation = (displayName: string) => {
    updateBasicInfo("location", displayName);
    setMapDialogOpen(false);
  };

  const getValidationMessage = () => {
    if (!canProceed()) {
      switch (state.step) {
        case 1:
          return "Please fill in all required fields";
        case 3:
          if (state.eventType === "oneTime") {
            return "Please select a date, time, and number of volunteers";
          }
          if (state.eventType === "multiDay") {
            return "Please ensure all days have valid dates, times, and volunteer counts";
          }
          if (state.eventType === "sameDayMultiArea") {
            return "Please ensure all roles have names, valid times, and volunteer counts";
          }
        case 4:
          return "Please select a verification method";
        default:
          return "";
      }
    }
    return "";
  };

  // Add submit function
  const handleSubmit = async () => {
    if (state.step !== 5) {
      nextStep();
      return;
    }
    try {
      setIsSubmitting(true);
      // Create form data for the server action
      const formData = new FormData();
      formData.append("projectData", JSON.stringify(state));
      const result = await createProject(formData);
      if (result.error) {
        toast({
          title: "Error",
          description: result.error,
          variant: "destructive",
        });
      } else if (result.id) {
        toast({
          title: "Success!",
          description: "Your project has been created successfully.",
        });
        router.push(`/projects/${result.id}`);
      }
    } catch (error) {
      console.error("Error submitting project:", error);
      toast({
        title: "Error",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Render step based on current state.step
  const renderStep = () => {
    switch (state.step) {
      case 1:
        return (
          <BasicInfo
            state={state}
            updateBasicInfoAction={updateBasicInfo}
            onMapClickAction={() => setMapDialogOpen(true)}
          />
        );
      case 2:
        return (
          <EventType
            eventType={state.eventType}
            setEventTypeAction={setEventType}
          />
        );
      case 3:
        return (
          <Schedule
            state={state}
            updateOneTimeScheduleAction={updateOneTimeSchedule}
            updateMultiDayScheduleAction={updateMultiDaySchedule}
            updateMultiRoleScheduleAction={updateMultiRoleSchedule}
            addMultiDaySlotAction={addMultiDaySlot}
            addMultiDayEventAction={addMultiDayEvent}
            addRoleAction={addRole}
            removeDayAction={removeDay}
            removeSlotAction={removeSlot}
            removeRoleAction={removeRole}
          />
        );
      case 4:
        return (
          <VerificationSettings
            verificationMethod={state.verificationMethod}
            requireLogin={state.requireLogin}
            updateVerificationMethodAction={updateVerificationMethod}
            updateRequireLoginAction={updateRequireLogin}
          />
        );
      case 5:
        return <Finalize state={state} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      {renderStep()}
      {getValidationMessage() && (
        <Alert variant="destructive" className="animate-in fade-in">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{getValidationMessage()}</AlertDescription>
        </Alert>
      )}
      <div className="flex justify-between gap-4">
        <Button
          variant="outline"
          onClick={prevStep}
          disabled={state.step === 1 || isSubmitting}
          className="w-[120px]"
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!canProceed() || isSubmitting}
          className="w-[120px]"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : state.step === 5 ? (
            "Create"
          ) : (
            <>
              Continue
              <ChevronRight className="h-4 w-4 ml-2" />
            </>
          )}
        </Button>
      </div>

      {/* Map Dialog for location search */}
      <Dialog open={mapDialogOpen} onOpenChange={setMapDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Search Location</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex">
              <Input
                placeholder="Enter location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") searchLocation();
                }}
                className="flex-grow"
              />
              <Button onClick={searchLocation} className="ml-2 shrink-0">
                {isLoading ? (
                  <Loader2 className="animate-spin h-4 w-4" />
                ) : (
                  "Search"
                )}
              </Button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {results.length > 0 ? (
                results.map((result, index) => (
                  <div
                    key={index}
                    className="p-2 cursor-pointer hover:bg-muted rounded-md flex flex-col"
                    onClick={() => handleSelectLocation(result.display_name)}
                  >
                    {formatLocation(result.display_name)}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No results found.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}