"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { GoogleMap, Marker, InfoWindow, useLoadScript } from "@react-google-maps/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"; 
import { Badge } from "@/components/ui/badge";
import { NoAvatar } from "@/components/NoAvatar";
import { Calendar, Users, MapPin, Locate, Loader2, Info } from "lucide-react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { LocationData } from "@/types";

const libraries = ["places"];

// Map container styles
const mapContainerStyle = {
  width: "100%",
  height: "100%",
};

// Default map center (San Francisco Bay Area)
const defaultCenter = {
  lat: 37.77,
  lng: -122.41,
};

interface ProjectsMapViewProps {
  projects: any[];
  className?: string;
}

export function ProjectsMapView({ projects, className }: ProjectsMapViewProps) {
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [userLocation, setUserLocation] = useState<google.maps.LatLngLiteral | null>(null);
  const [selectedProject, setSelectedProject] = useState<any | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const infoWindowRef = useRef<null | google.maps.InfoWindow>(null);
  
  // Load Google Maps script
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    libraries: libraries as any,
  });
  
  // Get user's current location
  const getUserLocation = useCallback(() => {
    setIsLocating(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userPos = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          setUserLocation(userPos);
          
          // Center map on user's location
          if (map) {
            map.setCenter(userPos);
            map.setZoom(12);
          }
          setIsLocating(false);
        },
        (error) => {
          console.error("Error getting location:", error);
          setIsLocating(false);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    } else {
      console.error("Geolocation is not supported by this browser");
      setIsLocating(false);
    }
  }, [map]);
  
  // Get marker position from project location data
  const getProjectPosition = (project: any): google.maps.LatLngLiteral | null => {
    try {
      if (project.location_data?.coordinates) {
        return {
          lat: project.location_data.coordinates.latitude,
          lng: project.location_data.coordinates.longitude
        };
      }
    } catch (e) {
      console.error("Error getting project position:", e);
    }
    return null;
  };
  
  // Format date display for projects
  const formatDateDisplay = (project: any) => {
    if (!project.event_type || !project.schedule) return "";

    switch (project.event_type) {
      case "oneTime": {
        return format(new Date(project.schedule.oneTime.date), "MMM d");
      }
      case "multiDay": {
        const dates = project.schedule.multiDay
          .map((day: any) => new Date(day.date))
          .sort((a: Date, b: Date) => a.getTime() - b.getTime());
        
        // If dates are in same month
        const allSameMonth = dates.every(
          (date: Date) => date.getMonth() === dates[0].getMonth()
        );
        
        if (dates.length <= 3) {
          if (allSameMonth) {
            // Format as "Mar 7, 9, 10"
            return `${format(dates[0], "MMM")} ${dates
              .map((date: Date) => format(date, "d"))
              .join(", ")}`;
          } else {
            // Format as "Mar 7, Apr 9, 10"
            return dates
              .map((date: Date, i: number) => {
                const prevDate = i > 0 ? dates[i - 1] : null;
                if (!prevDate || prevDate.getMonth() !== date.getMonth()) {
                  return format(date, "MMM d");
                }
                return format(date, "d");
              })
              .join(", ");
          }
        } else {
          // For more than 3 dates, show range
          return `${format(dates[0], "MMM d")} - ${format(dates[dates.length - 1], "MMM d")}`;
        }
      }
      case "sameDayMultiArea": {
        return format(new Date(project.schedule.sameDayMultiArea.date), "MMM d");
      }
      default:
        return "";
    }
  };

  // Format volunteer spots
  const formatSpots = (count: number) => {
    return `${count} ${count === 1 ? 'spot' : 'spots'}`;
  };

  // Get volunteer count from a project
  const getVolunteerCount = (project: any): number => {
    if (!project.event_type || !project.schedule) return 0;

    switch (project.event_type) {
      case "oneTime":
        return project.schedule.oneTime?.volunteers || 0;
      case "multiDay": {
        let total = 0;
        if (project.schedule.multiDay) {
          project.schedule.multiDay.forEach((day: any) => {
            if (day.slots) {
              day.slots.forEach((slot: any) => {
                total += slot.volunteers || 0;
              });
            }
          });
        }
        return total;
      }
      case "sameDayMultiArea": {
        let total = 0;
        if (project.schedule.sameDayMultiArea?.roles) {
          project.schedule.sameDayMultiArea.roles.forEach((role: any) => {
            total += role.volunteers || 0;
          });
        }
        return total;
      }
      default:
        return 0;
    }
  };
  
  // Callback when map loads
  const onLoad = useCallback((map: google.maps.Map) => {
    setMap(map);
    
    // Try to get user location when map loads
    getUserLocation();
  }, [getUserLocation]);
  
  // Cleanup on unmount
  const onUnmount = useCallback(() => {
    setMap(null);
  }, []);

  // Filter projects that have valid coordinates
  const projectsWithCoordinates = projects.filter(project => getProjectPosition(project) !== null);
  
  // If still loading or error loading Google Maps
  if (!isLoaded) {
    return (
      <div className={cn("w-full h-[500px] rounded-md border flex items-center justify-center bg-muted", className)}>
        <div className="flex flex-col items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground mb-2" />
          <p className="text-muted-foreground">Loading map...</p>
        </div>
      </div>
    );
  }
  
  if (loadError) {
    return (
      <div className={cn("w-full h-[500px] rounded-md border flex items-center justify-center bg-muted", className)}>
        <div className="flex flex-col items-center justify-center">
          <Info className="h-10 w-10 text-destructive mb-2" />
          <p className="text-destructive font-medium">Error loading map</p>
          <p className="text-sm text-muted-foreground mt-1">Please check your internet connection and try again</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-full h-[500px] rounded-md border overflow-hidden relative", className)}>
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={userLocation || defaultCenter}
        zoom={userLocation ? 12 : 10}
        onLoad={onLoad}
        onUnmount={onUnmount}
        options={{
          fullscreenControl: false,
          streetViewControl: false,
          mapTypeControl: true,
          zoomControl: true,
          mapTypeId: google.maps.MapTypeId.ROADMAP,
          mapTypeControlOptions: {
            style: google.maps.MapTypeControlStyle.DROPDOWN_MENU,
            position: google.maps.ControlPosition.TOP_RIGHT
          }
        }}
      >
        {/* Show user location marker */}
        {userLocation && (
          <Marker
            position={userLocation}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: "#3B82F6",
              fillOpacity: 1,
              strokeColor: "#FFFFFF",
              strokeWeight: 2,
            }}
            title="Your location"
          />
        )}
        
        {/* Project markers */}
        {projectsWithCoordinates.map((project) => {
          const position = getProjectPosition(project);
          if (!position) return null;
          
          return (
            <Marker
              key={project.id}
              position={position}
              onClick={() => setSelectedProject(project)}
            />
          );
        })}
        
        {/* Info window for selected project */}
        {selectedProject && (
          <InfoWindow
            position={getProjectPosition(selectedProject)!}
            onCloseClick={() => setSelectedProject(null)}
          >
            <div className="max-w-[300px]">
              <h4 className="font-medium mb-1">{selectedProject.title}</h4>
              <div className="flex items-center gap-1 mb-2">
                <MapPin className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{selectedProject.location}</span>
              </div>
              <div className="flex flex-wrap gap-1 mb-3">
                <Badge variant="outline" className="gap-1 text-xs">
                  <Calendar className="h-3 w-3" />
                  {formatDateDisplay(selectedProject)}
                </Badge>
                <Badge variant="outline" className="gap-1 text-xs">
                  <Users className="h-3 w-3" />
                  {formatSpots(getVolunteerCount(selectedProject))}
                </Badge>
              </div>
              <Link href={`/projects/${selectedProject.id}`}>
                <Button size="sm" className="w-full">View Details</Button>
              </Link>
            </div>
          </InfoWindow>
        )}
      </GoogleMap>
      
      {/* Locate me button */}
      <Button 
        onClick={getUserLocation}
        disabled={isLocating}
        className="absolute bottom-4 left-4 gap-2 shadow-md"
      >
        {isLocating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Locating...
          </>
        ) : (
          <>
            <Locate className="h-4 w-4" />
            Current Location
          </>
        )}
      </Button>
      
      {/* Projects without coordinates message */}
      {projectsWithCoordinates.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 backdrop-blur-sm pointer-events-none">
          <Card className="w-[350px] pointer-events-auto">
            <CardHeader>
              <CardTitle className="text-center">No Projects on Map</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-center text-muted-foreground">
                There are no projects with location coordinates to display on the map. Please try a different view or adjust your filters.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
      
      {/* Project count badge */}
      {projectsWithCoordinates.length > 0 && (
        <div className="absolute top-4 left-4 bg-background/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm border">
          <span className="text-sm font-medium">
            {projectsWithCoordinates.length} {projectsWithCoordinates.length === 1 ? 'project' : 'projects'} nearby
          </span>
        </div>
      )}
    </div>
  );
}
