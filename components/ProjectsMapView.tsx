"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { APIProvider, Map, AdvancedMarker, useApiIsLoaded, ColorScheme, RenderingType } from "@vis.gl/react-google-maps";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Users, MapPin, Loader2, AlertCircle } from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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

// Map ID for styling
const mapId = "e54dd2f307297bcd";

// Radius for filtering projects (25 miles in meters)
const RADIUS_MILES = 25;
const RADIUS_METERS = RADIUS_MILES * 1609.34; // Convert miles to meters

import type { Project, MultiDayScheduleDay, MultiDaySlot, SameDayMultiAreaRole } from "@/types";

interface ProjectsMapViewProps {
  className?: string;
  initialProjects?: Project[];
  projects?: Project[]; // Add projects prop
}

function ProjectMapInfoWindow({ project, onClose }: { project: Project; onClose: () => void }) {
  // Format date display for projects
  const formatDateDisplay = (project: Project) => {
    if (!project.event_type || !project.schedule) return "";

    switch (project.event_type) {
      case "oneTime": {
        if (!project.schedule.oneTime) return "";
        return format(new Date(project.schedule.oneTime.date), "MMM d");
      }
      case "multiDay": {
        if (!project.schedule.multiDay) return "";
        const dates = project.schedule.multiDay
          .map((day: MultiDayScheduleDay) => new Date(day.date))
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
        if (!project.schedule.sameDayMultiArea) return "";
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
  const getVolunteerCount = (project: Project): number => {
    if (!project.event_type || !project.schedule) return 0;

    switch (project.event_type) {
      case "oneTime":
        return project.schedule.oneTime?.volunteers || 0;
      case "multiDay": {
        let total = 0;
        if (project.schedule.multiDay) {
          project.schedule.multiDay.forEach((day: MultiDayScheduleDay) => {
            if (day.slots) {
              day.slots.forEach((slot: MultiDaySlot) => {
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
          project.schedule.sameDayMultiArea.roles.forEach((role: SameDayMultiAreaRole) => {
            total += role.volunteers || 0;
          });
        }
        return total;
      }
      default:
        return 0;
    }
  };

  return (
    <div className="custom-info-window bg-white dark:bg-black p-3 rounded-lg shadow-lg max-w-[300px] border">
      <button 
        className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-800" 
        onClick={onClose}
        aria-label="Close info window"
      >
        &times;
      </button>
      <div className="text-black dark:text-white">
        <h4 className="font-semibold mb-1 text-lg">{project.title}</h4>
        <div className="flex items-center gap-1 mb-2">
          <MapPin className="h-3 w-3" />
          <span className="text-xs">{project.location}</span>
        </div>
        <div className="flex flex-wrap gap-1 mb-3">
          <Badge variant="outline" className="gap-1 text-xs text-black dark:text-white">
        <Calendar className="h-3 w-3" />
        {formatDateDisplay(project)}
          </Badge>
          <Badge variant="outline" className="gap-1 text-xs text-black dark:text-white">
        <Users className="h-3 w-3" />
        {formatSpots(getVolunteerCount(project))}
          </Badge>
        </div>
        <Link href={`/projects/${project.id}`}>
          <Button size="sm" className="w-full bg-green-600 hover:bg-green-600/90 text-white">View Details</Button>
        </Link>
      </div>
    </div>
  );
}

function MapContent({ initialProjects, projects: externalProjects, className }: ProjectsMapViewProps) {
  const { resolvedTheme } = useTheme();
  const [userLocation, setUserLocation] = useState<google.maps.LatLngLiteral | null>(null);
  const [projects, setProjects] = useState<Project[]>(initialProjects ?? externalProjects ?? []);
  const [filteredProjects, setFilteredProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isLoading, setIsLoading] = useState(!initialProjects);
  const [error, setError] = useState<string | null>(null);
  // Always show radius notice when we have user location
  const [showRadiusNotice, setShowRadiusNotice] = useState(false);
  const mapRef = useRef<google.maps.Map | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const isLoaded = useApiIsLoaded();
  const initialLoadRef = useRef(true);
  // Add ref to track if component is mounted
  const isMountedRef = useRef(false);
  
  // Define the map color scheme based on theme
  const mapColorScheme = resolvedTheme === 'dark' ? ColorScheme.DARK : ColorScheme.LIGHT;
  
  // Get project marker position
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
  
  // Calculate distance between two points in kilometers
  const calculateDistance = (point1: google.maps.LatLngLiteral, point2: google.maps.LatLngLiteral): number => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = point1.lat * Math.PI / 180;
    const φ2 = point2.lat * Math.PI / 180;
    const Δφ = (point2.lat - point1.lat) * Math.PI / 180;
    const Δλ = (point2.lng - point1.lng) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in meters
  };
  
  // Filter projects by distance
  const filterProjectsByDistance = useCallback(() => {
    if (!userLocation) {
      setFilteredProjects(projects);
      return;
    }
    
    const filtered = projects.filter(project => {
      const position = getProjectPosition(project);
      if (!position) return false;
      
      const distance = calculateDistance(userLocation, position);
      return distance <= RADIUS_METERS;
    });
    
    setFilteredProjects(filtered);
    
    // Show radius notice if any projects were filtered out
    if (filtered.length < projects.length) {
      setShowRadiusNotice(true);
    }
  }, [userLocation, projects]);
  
  // Fetch projects from API
  const fetchProjects = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch('/api/projects');
      if (!response.ok) {
        throw new Error(`Error fetching projects: ${response.status}`);
      }
      
      const data = await response.json();
      setProjects(data);
    } catch (err: unknown) {
      console.error('Error fetching projects:', err);
      setError((err as Error)?.message ?? 'Failed to fetch projects');
    } finally {
      setIsLoading(false);
    }
  }, []);
  
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
          setShowRadiusNotice(true);
          
          // Only pan to location when explicitly requested via the button
          if (mapRef.current) {
            mapRef.current.panTo(userPos);
            setTimeout(() => {
              if (mapRef.current) {
                mapRef.current.setZoom(13);
              }
            }, 300);
          }
          
          setIsLocating(false);
        },
        (error) => {
          console.error("Error getting location:", error);
          let errorMessage = "We couldn't determine your location.";
          
          // Provide specific error messages
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = "Location access was denied. Please enable location services in your browser settings.";
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = "Location information is unavailable. Please try again later.";
              break;
            case error.TIMEOUT:
              errorMessage = "The request to get your location timed out. Please try again.";
              break;
          }
          
          alert(errorMessage);
          setIsLocating(false);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    } else {
      console.error("Geolocation is not supported by this browser");
      alert("Your browser doesn't support geolocation features.");
      setIsLocating(false);
    }
  }, []); // No dependencies needed since we're using state setters
  
  // Auto-locate user on initial component mount
  useEffect(() => {
    // Only run this once when component mounts
    if (initialLoadRef.current && isLoaded) {
      initialLoadRef.current = false;
      getUserLocation();
    }
  }, [getUserLocation, isLoaded]);
  
  // Initial data fetch
  useEffect(() => {
    if (!initialProjects) {
      fetchProjects();
    }
  }, [fetchProjects, initialProjects]);
  
  // Apply distance filter when user location or projects change
  useEffect(() => {
    filterProjectsByDistance();
  }, [userLocation, projects, filterProjectsByDistance]);
  
  // Draw radius circle on map
  useEffect(() => {
    if (mapRef.current && userLocation) {
      // Remove previous circle if exists
      if (circleRef.current) {
        circleRef.current.setMap(null);
      }
      
      // Create new circle
      circleRef.current = new google.maps.Circle({
        center: userLocation,
        radius: RADIUS_METERS,
        strokeColor: '#3B82F6',
        strokeOpacity: 0.6,
        strokeWeight: 1,
        fillColor: '#3B82F6',
        fillOpacity: 0.1,
        map: mapRef.current
      });
    }
  }, [userLocation]);

  // Handle map render - make sure we store the map reference properly
  const handleMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    
    // Restore previous map state if available
    const savedState = sessionStorage.getItem('mapState');
    if (savedState) {
      try {
        const { center, zoom } = JSON.parse(savedState);
        map.setCenter(center);
        map.setZoom(zoom);
      } catch (e) {
        console.error('Error restoring map state:', e);
      }
    }
  }, []);
  
  // Filter projects that have valid coordinates
  const projectsWithCoordinates = filteredProjects.filter(project => getProjectPosition(project) !== null);
  
  // Update the initial load effect
  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      if (isLoaded) {
        getUserLocation();
      }
    }
  }, [getUserLocation, isLoaded]);

  // Keep the map reference when switching views
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        // Store the last map position and zoom in sessionStorage
        const center = mapRef.current.getCenter();
        const zoom = mapRef.current.getZoom();
        if (center && zoom) {
          sessionStorage.setItem('mapState', JSON.stringify({
            center: { lat: center.lat(), lng: center.lng() },
            zoom
          }));
        }
      }
    };
  }, []);

  if (!isLoaded) {
    return (
      <div className="w-full h-full rounded-md flex items-center justify-center bg-muted">
        <div className="flex flex-col items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground mb-2" />
          <p className="text-muted-foreground">Loading map...</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="w-full h-full rounded-md flex items-center justify-center bg-muted">
        <div className="flex flex-col items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground mb-2" />
          <p className="text-muted-foreground">Loading projects...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full rounded-md flex items-center justify-center bg-muted p-4">
        <div className="max-w-md">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <Map
        mapId={mapId}
        defaultZoom={userLocation ? 13 : 10}
        defaultCenter={userLocation || defaultCenter}
        gestureHandling="greedy"
        style={mapContainerStyle}
        fullscreenControl={false}
        streetViewControl={false}
        mapTypeControl={false}
        zoomControl={true}
        mapTypeId={google.maps.MapTypeId.ROADMAP}
        colorScheme={mapColorScheme}
        renderingType={RenderingType.RASTER}
        // @ts-ignore: onLoad prop is not defined in MapOptions but required to get map instance.
        onLoad={handleMapLoad} 
      >
        {/* User location marker with improved styling */}
        {userLocation && (
          <AdvancedMarker
            position={userLocation}
            title="Your location"
          >
            <div className="relative">
              <div className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-lg"></div>
              <div className="absolute top-0 left-0 w-4 h-4 rounded-full bg-blue-400 opacity-70 animate-ping" 
                   style={{ animationDuration: '2s' }}></div>
            </div>
          </AdvancedMarker>
        )}
        
        {/* Project markers */}
        {projectsWithCoordinates.map((project) => {
          const position = getProjectPosition(project);
          if (!position) return null;
          
          return (
            <AdvancedMarker
              key={project.id}
              position={position}
              onClick={() => setSelectedProject(project)}
            >
              <div className="w-5 h-5 bg-green-600 rounded-full border-2 border-white flex items-center justify-center text-xs text-white" 
                   aria-label={`Project marker for ${project.title}`}>
              </div>
            </AdvancedMarker>
          );
        })}
        
        {/* Custom info window for selected project */}
        {selectedProject && (
          <AdvancedMarker
            position={getProjectPosition(selectedProject)!}
            clickable={false}
          >
            <div className="animate-fadeIn">
              <ProjectMapInfoWindow 
                project={selectedProject}
                onClose={() => setSelectedProject(null)}
              />
            </div>
          </AdvancedMarker>
        )}
      </Map>
      
      {/* Always show radius notice when we have user location */}
      {userLocation && (
        <div className="hidden sm:inline absolute top-4 left-1/2 transform -translate-x-1/2 bg-background/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm border">
          <span className="text-xs text-center font-medium">
            Showing projects within {RADIUS_MILES} miles
          </span>
        </div>
      )}
      
      {/* Locate me button with clear intent */}
      {/* <Button 
        onClick={getUserLocation}
        disabled={isLocating}
        className="absolute bottom-4 left-4 gap-2 shadow-md bg-gray-800 hover:bg-gray-700 text-white"
      >
        {isLocating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Locating...
          </>
        ) : (
          <>
            <Locate className="h-4 w-4" />
            {userLocation ? "Return to My Location" : "Show My Location"}
          </>
        )}
      </Button> */}
      
      {/* Project count badge */}
      {projectsWithCoordinates.length > 0 && (
        <div className="absolute top-4 left-4 bg-background/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-sm border">
          <span className="text-sm font-medium">
            {projectsWithCoordinates.length} {projectsWithCoordinates.length === 1 ? 'project' : 'projects'} nearby
          </span>
        </div>
      )}
      
      {/* Add the animation for info window fade-in */}
      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  );
}

export function ProjectsMapView({ initialProjects, projects, className }: ProjectsMapViewProps) {
  return (
    <div className={cn("w-full h-[500px] rounded-md border overflow-hidden relative", className)}>
      <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ""}>
        <MapContent 
          initialProjects={initialProjects} 
          projects={projects} 
          className={className} 
        />
      </APIProvider>
    </div>
  );
}
