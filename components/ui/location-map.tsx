"use client";

import { useCallback, useRef, useState } from "react";
import { GoogleMap, Marker, useLoadScript } from "@react-google-maps/api";
import { LocationData } from "@/types";

const libraries = ["places"];

// Map container styles
const mapContainerStyle = {
  width: "100%",
  height: "100%",
};

// Default center (San Francisco Bay Area)
const defaultCenter = {
  lat: 37.77,
  lng: -121.9,
};

interface LocationMapProps {
  location?: LocationData;
  readOnly?: boolean;
  height?: string;
  showAttribution?: boolean;
}

export function LocationMap({
  location,
  readOnly = true,
  height = "h-[300px]",
  showAttribution = true
}: LocationMapProps) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  
  // Load Google Maps script
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    libraries: libraries as any,
  });
  
  // Get marker position from location data
  const getMarkerPosition = (): google.maps.LatLngLiteral | undefined => {
    if (!location?.coordinates) return undefined;
    
    return {
      lat: location.coordinates.latitude,
      lng: location.coordinates.longitude
    };
  };
  
  // Callback when map loads
  const onLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    setMap(map);
    
    // If we have coordinates, center the map on them
    if (location?.coordinates) {
      map.setCenter({
        lat: location.coordinates.latitude,
        lng: location.coordinates.longitude
      });
      map.setZoom(15);
    }
  }, [location]);
  
  // Cleanup on unmount
  const onUnmount = useCallback(() => {
    mapRef.current = null;
    setMap(null);
  }, []);
  
  // If still loading or error loading Google Maps
  if (!isLoaded) {
    return (
      <div className={`w-full ${height} rounded-md overflow-hidden border border-border flex items-center justify-center bg-muted`}>
        <div className="text-sm text-muted-foreground">Loading map...</div>
      </div>
    );
  }
  
  if (loadError) {
    return (
      <div className={`w-full ${height} rounded-md overflow-hidden border border-border flex items-center justify-center bg-muted`}>
        <div className="text-sm text-destructive">Error loading Google Maps</div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className={`w-full ${height} rounded-md overflow-hidden border border-border relative`}>
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={getMarkerPosition() || defaultCenter}
          zoom={getMarkerPosition() ? 15 : 10}
          onLoad={onLoad}
          onUnmount={onUnmount}
          options={{
            fullscreenControl: false,
            streetViewControl: false,
            mapTypeControl: false,
            zoomControl: true,
            mapTypeId: google.maps.MapTypeId.ROADMAP,
            mapTypeControlOptions: {
              style: google.maps.MapTypeControlStyle.DROPDOWN_MENU
            }
          }}
        >
          {getMarkerPosition() && <Marker position={getMarkerPosition()!} />}
        </GoogleMap>
          
        {/* Show a message if no location data is available */}
        {!location?.coordinates && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50 backdrop-blur-sm">
            <p className="text-sm text-muted-foreground">No location selected</p>
          </div>
        )}
      </div>
    </div>
  );
}