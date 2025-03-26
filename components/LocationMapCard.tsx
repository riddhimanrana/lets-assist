"use client";

import { useRef, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LocationData } from '@/types';
import { Button } from '@/components/ui/button';
import { ExternalLink, MapPin } from 'lucide-react';
import { GoogleMap, Marker, useLoadScript } from "@react-google-maps/api";

const libraries = ["places"];

// Map container styles
const mapContainerStyle = {
  width: "100%",
  height: "100%",
};

// Default center (SF Bay Area)
const defaultCenter = {
  lat: 37.77,
  lng: -121.9,
};

interface LocationMapCardProps {
  location: string;
  locationData?: LocationData;
}

export function LocationMapCard({ location, locationData }: LocationMapCardProps) {
  const [map, setMap] = useState<google.maps.Map | null>(null);
  
  // Load Google Maps script
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    libraries: libraries as any,
  });

  // Updated function to create a more precise Google Maps URL
  const createGoogleMapsUrl = () => {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((location || locationData?.display_name) ?? '')}`;
  };

  // Get marker position from location data
  const getMarkerPosition = (): google.maps.LatLngLiteral | undefined => {
    if (!locationData?.coordinates) return undefined;
    
    return {
      lat: locationData.coordinates.latitude,
      lng: locationData.coordinates.longitude
    };
  };
  
  // Callback when map loads
  const onLoad = useCallback((map: google.maps.Map) => {
    setMap(map);
    
    // If we have coordinates, center the map on them
    if (locationData?.coordinates) {
      map.setCenter({
        lat: locationData.coordinates.latitude,
        lng: locationData.coordinates.longitude
      });
      map.setZoom(15);
    }
  }, [locationData]);
  
  // Cleanup on unmount
  const onUnmount = useCallback(() => {
    setMap(null);
  }, []);
  
  // Has coordinates helper
  const hasCoordinates = !!locationData?.coordinates?.latitude && !!locationData?.coordinates?.longitude;

  // If still loading or error loading Google Maps
  if (!isLoaded) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center">
            <MapPin className="h-5 w-5 mr-2" />
            Location
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">{location}</div>
          <div className="h-[200px] rounded-md border flex items-center justify-center bg-muted">
            <div className="text-sm text-muted-foreground">Loading map...</div>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  if (loadError) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center">
            <MapPin className="h-5 w-5 mr-2" />
            Location
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">{location}</div>
          <div className="h-[200px] rounded-md border flex items-center justify-center bg-muted">
            <div className="text-sm text-destructive">Error loading map</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center">
          <MapPin className="h-5 w-5 mr-2" />
          Location
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          {locationData?.display_name || location}
        </div>
        
        <div className="relative w-full h-[200px] rounded-md overflow-hidden border">
          <GoogleMap
            mapContainerStyle={mapContainerStyle}
            center={getMarkerPosition() || defaultCenter}
            zoom={hasCoordinates ? 15 : 10}
            onLoad={onLoad}
            onUnmount={onUnmount}
            options={{
              fullscreenControl: false,
              streetViewControl: false,
              mapTypeControl: false,
              zoomControl: true,
              mapTypeId: google.maps.MapTypeId.ROADMAP
            }}
          >
            {hasCoordinates && <Marker position={getMarkerPosition()!} />}
          </GoogleMap>
          
          {/* Show a message if no location data is available */}
          {!hasCoordinates && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/50 backdrop-blur-sm">
              <p className="text-sm text-muted-foreground">No precise location available</p>
            </div>
          )}
        </div>
        
        <Button 
          variant="outline" 
          size="sm"
          className="w-full"
          onClick={() => window.open(createGoogleMapsUrl(), '_blank')}
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          Open in Google Maps
        </Button>
      </CardContent>
    </Card>
  );
}