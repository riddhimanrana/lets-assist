"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LocationData } from '@/types';
import { Button } from '@/components/ui/button';
import { ExternalLink, MapPin } from 'lucide-react';
import { LocationMap } from "@/components/ui/location-map";

interface LocationMapCardProps {
  location: string;
  locationData?: LocationData;
}

export function LocationMapCard({ location, locationData }: LocationMapCardProps) {
  // Updated function to create a more precise Google Maps URL
  const createGoogleMapsUrl = () => {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((location || locationData?.display_name) ?? '')}`;
  };

  return (
    <Card>
      <CardHeader className="">
        <CardTitle className="flex items-center">
          <MapPin className="h-5 w-5 mr-2" aria-hidden="true" />
          <span>Location</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground">
          {locationData?.display_name || location}
        </div>

        <LocationMap
          location={locationData ?? { text: location }}
          height="h-[200px]"
        />
        
        <Button 
          variant="outline" 
          size="sm"
          className="w-full"
          onClick={() => window.open(createGoogleMapsUrl(), '_blank')}
          aria-label={`Open ${locationData?.display_name || location} in Google Maps`}
        >
          <ExternalLink className="h-4 w-4 mr-2" aria-hidden="true" />
          Open in Google Maps
        </Button>
      </CardContent>
    </Card>
  );
}
