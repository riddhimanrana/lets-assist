"use client";

import {
  AdvancedMarker,
  APILoadingStatus,
  APIProvider,
  Map,
  useApiLoadingStatus,
} from "@vis.gl/react-google-maps";
import type { LocationData } from "@/types";

// Default center (San Francisco Bay Area)
const defaultCenter = {
  lat: 37.77,
  lng: -121.9,
};

// Map IDs for different themes
const MAP_ID = "f21d109664fa3fad";

interface LocationMapProps {
  location?: LocationData;
  readOnly?: boolean;
  height?: string;
  showAttribution?: boolean;
}

function LocationMapContent({
  location,
  height,
}: {
  location?: LocationData;
  height: string;
}) {
  const loadingStatus = useApiLoadingStatus();
  const markerPosition = location?.coordinates
    ? {
        lat: location.coordinates.latitude,
        lng: location.coordinates.longitude,
      }
    : undefined;

  if (loadingStatus === APILoadingStatus.FAILED) {
    return (
      <div
        className={`w-full ${height} rounded-md overflow-hidden border border-border flex items-center justify-center bg-muted`}
      >
        <div className="text-sm text-destructive">
          Error loading Google Maps
        </div>
      </div>
    );
  }

  if (loadingStatus !== APILoadingStatus.LOADED) {
    return (
      <div
        className={`w-full ${height} rounded-md overflow-hidden border border-border flex items-center justify-center bg-muted`}
      >
        <div className="text-sm text-muted-foreground">Loading map...</div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div
        className={`w-full ${height} rounded-md overflow-hidden border border-border relative`}
      >
        <Map
          mapId={MAP_ID}
          defaultCenter={markerPosition ?? defaultCenter}
          defaultZoom={markerPosition ? 15 : 10}
          fullscreenControl={false}
          streetViewControl={false}
          mapTypeControl={false}
          zoomControl
          mapTypeId="roadmap"
          style={{ width: "100%", height: "100%" }}
        >
          {markerPosition && (
            <AdvancedMarker position={markerPosition} clickable={false}>
              <div className="h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow-md ring-2 ring-primary/25" />
            </AdvancedMarker>
          )}
        </Map>

        {/* Show a message if no location data is available */}
        {!location?.coordinates && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50 backdrop-blur-xs">
            <p className="text-sm text-muted-foreground">
              No location selected
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function LocationMap({
  location,
  height = "h-[300px]",
}: Omit<LocationMapProps, "readOnly" | "showAttribution">) {
  return (
    <APIProvider
      apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ""}
      libraries={["places"]}
    >
      <LocationMapContent location={location} height={height} />
    </APIProvider>
  );
}
