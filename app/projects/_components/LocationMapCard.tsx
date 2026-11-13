"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LocationData } from "@/types";
import { Button } from "@/components/ui/button";
import { ExternalLink, Video } from "lucide-react";
import { LocationMap } from "@/components/ui/location-map";

interface LocationMapCardProps {
  location: string;
  locationData?: LocationData;
}

export function LocationMapCard({
  location,
  locationData,
}: LocationMapCardProps) {
  const label = (locationData?.display_name || location || "").trim();
  const isOnline =
    /^(online|virtual|remote)(\b|$)/i.test(label) ||
    /^https?:\/\//i.test(label);
  if (isOnline || !label) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{isOnline ? "Online event" : "Location"}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-start gap-3 text-sm text-muted-foreground">
          {isOnline && <Video aria-hidden="true" className="size-5 shrink-0" />}
          <div>
            <p>{label || "Location to be announced"}</p>
            {isOnline && (
              <p className="mt-2">
                Check the project instructions or contact the organizer for
                joining details.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }
  // Updated function to create a more precise Google Maps URL
  const createGoogleMapsUrl = () => {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((location || locationData?.display_name) ?? "")}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Location</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground">
          {locationData?.display_name || location}
        </div>

        {locationData?.coordinates && (
          <LocationMap location={locationData} height="h-50" />
        )}

        <Button
          variant="outline"
          className="w-full"
          onClick={() =>
            window.open(createGoogleMapsUrl(), "_blank", "noopener,noreferrer")
          }
          aria-label={`Open ${locationData?.display_name || location} in Google Maps`}
        >
          <ExternalLink data-icon="inline-start" aria-hidden="true" />
          Open in Google Maps
        </Button>
      </CardContent>
    </Card>
  );
}
