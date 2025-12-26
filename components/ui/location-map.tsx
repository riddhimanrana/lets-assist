"use client"

import { useCallback, useRef, useState, useEffect } from "react"
import { GoogleMap, Marker, useLoadScript } from "@react-google-maps/api"
import { useTheme } from "next-themes"
import type { LocationData } from "@/types"

const libraries = ["places"]

// Map container styles
const mapContainerStyle = {
  width: "100%",
  height: "100%",
}

// Default center (San Francisco Bay Area)
const defaultCenter = {
  lat: 37.77,
  lng: -121.9,
}

// Map IDs for different themes
const MAP_ID = "f21d109664fa3fad"

interface LocationMapProps {
  location?: LocationData
  readOnly?: boolean
  height?: string
  showAttribution?: boolean
}

export function LocationMap({
  location,
  readOnly = true,
  height = "h-[300px]",
  showAttribution = true,
}: LocationMapProps) {
  const mapRef = useRef<google.maps.Map | null>(null)
  const [map, setMap] = useState<google.maps.Map | null>(null)
  const { theme, systemTheme } = useTheme()
  // Map ID is constant; not storing it in local state to avoid unused var lint issues

  // Determine if dark mode is active
  const isDarkMode = theme === "dark" || (theme === "system" && systemTheme === "dark")

  // Load Google Maps script
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    libraries: libraries as any,
  })

  // Update map styling when theme changes
  useEffect(() => {
    if (map) {
      // Apply the map ID with the appropriate theme
      map.setOptions({
        mapId: MAP_ID,
        styles: isDarkMode ? [] : [], // The map ID handles styling, so we don't need custom styles
      })
    }
  }, [map, isDarkMode])

  // Get marker position from location data
  const getMarkerPosition = (): google.maps.LatLngLiteral | undefined => {
    if (!location?.coordinates) return undefined

    return {
      lat: location.coordinates.latitude,
      lng: location.coordinates.longitude,
    }
  }

  // Callback when map loads
  const onLoad = useCallback(
    (map: google.maps.Map) => {
      mapRef.current = map
      setMap(map)

      // If we have coordinates, center the map on them
      if (location?.coordinates) {
        map.setCenter({
          lat: location.coordinates.latitude,
          lng: location.coordinates.longitude,
        })
        map.setZoom(15)
      }
    },
    [location],
  )

  // Cleanup on unmount
  const onUnmount = useCallback(() => {
    mapRef.current = null
    setMap(null)
  }, [])

  // If still loading or error loading Google Maps
  if (!isLoaded) {
    return (
      <div
        className={`w-full ${height} rounded-md overflow-hidden border border-border flex items-center justify-center bg-muted`}
      >
        <div className="text-sm text-muted-foreground">Loading map...</div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div
        className={`w-full ${height} rounded-md overflow-hidden border border-border flex items-center justify-center bg-muted`}
      >
        <div className="text-sm text-destructive">Error loading Google Maps</div>
      </div>
    )
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
            mapTypeId: (window as any).google?.maps?.MapTypeId.ROADMAP,
            mapId: MAP_ID, // Apply your map ID here
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
  )
}

