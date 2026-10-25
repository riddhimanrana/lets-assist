"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LocationData } from "@/types";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { LocationMap } from "@/components/ui/location-map";

interface LocationMapCardProps {
  location: string;
  locationData?: LocationData;
}

export function LocationMapCard({
  location,
  locationData,
}: LocationMapCardProps) {
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

        <LocationMap
          location={locationData ?? { text: location }}
          height="h-50"
        />

        <Button
          variant="outline"
          className="w-full"
          onClick={() => window.open(createGoogleMapsUrl(), "_blank")}
          aria-label={`Open ${locationData?.display_name || location} in Google Maps`}
        >
          <ExternalLink data-icon="inline-start" aria-hidden="true" />
          Open in Google Maps
        </Button>
      </CardContent>
    </Card>
  );
}
