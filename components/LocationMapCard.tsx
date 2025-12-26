"use client";

import { useTheme } from 'next-themes';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LocationData } from '@/types';
import { MapPin } from 'lucide-react';
import { APIProvider, Map, AdvancedMarker, ColorScheme, useApiIsLoaded, RenderingType } from "@vis.gl/react-google-maps";

// Map container styles
const mapContainerStyle = {
  width: "100%",
  height: "100%",
  borderRadius: "0.375rem",
};

// Default center (SF Bay Area)
const defaultCenter = {
  lat: 37.77,
  lng: -121.9,
};

// Map ID for styling
const mapId = "f21d109664fa3fad";

interface LocationMapCardProps {
  location: string;
  locationData?: LocationData;
}

function MapComponent({ location: _location, locationData }: LocationMapCardProps) {
  // Get the current theme
  const { resolvedTheme } = useTheme();
  
  // Determine the map color scheme based on the theme
  const mapColorScheme = resolvedTheme === 'dark' ? ColorScheme.DARK : ColorScheme.LIGHT;
  
  // Check if API is loaded
  const isLoaded = useApiIsLoaded();
  
  // Get marker position from location data
  const getMarkerPosition = (): google.maps.LatLngLiteral | undefined => {
    if (!locationData?.coordinates) return undefined;
    
    return {
      lat: locationData.coordinates.latitude,
      lng: locationData.coordinates.longitude
    };
  };
  
  // Has coordinates helper
  const hasCoordinates = !!locationData?.coordinates?.latitude && !!locationData?.coordinates?.longitude;
  const markerPosition = getMarkerPosition();
  
  if (!isLoaded) {
    return (
      <div className="h-[200px] rounded-md border flex items-center justify-center bg-muted">
        <div className="text-sm text-muted-foreground">Loading map...</div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[200px] rounded-md overflow-hidden border">
      <Map
        mapId={mapId}
        defaultZoom={hasCoordinates ? 15 : 10}
        defaultCenter={markerPosition || defaultCenter}
        gestureHandling={"greedy"}
        style={mapContainerStyle}
        fullscreenControl={false}
        streetViewControl={false}
        mapTypeControl={false}
        zoomControl={true}
        mapTypeId={google.maps.MapTypeId.ROADMAP}
        colorScheme={mapColorScheme}
        renderingType={RenderingType.RASTER}
      >
        {hasCoordinates && markerPosition && (
          <AdvancedMarker position={markerPosition}>
          </AdvancedMarker>
        )}
      </Map>
      
      {/* Show a message if no location data is available */}
      {!hasCoordinates && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 backdrop-blur-sm">
          <p className="text-sm text-muted-foreground">No precise location available</p>
        </div>
      )}
    </div>
  );
}

export function LocationMapCard({ location, locationData }: LocationMapCardProps) {
  // Updated function to create a more precise Google Maps URL
  const createGoogleMapsUrl = () => {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((location || locationData?.display_name) ?? '')}`;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center">
          <MapPin className="h-5 w-5 mr-2" aria-hidden="true" />
          <span>Location</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          {locationData?.display_name || location}
        </div>
        
        <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ""}>
          <MapComponent location={location} locationData={locationData} />
        </APIProvider>
        
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