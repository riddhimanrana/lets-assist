"use client"

import * as React from "react"
import { useState, useRef, useEffect } from "react"
import { Check, MapPin, Search, Loader2, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { APIProvider, useApiIsLoaded } from "@vis.gl/react-google-maps"
import { LocationData } from "@/types"

interface LocationAutocompleteProps {
  id?: string;
  value?: LocationData;
  onChangeAction: (location?: LocationData) => void;
  maxLength?: number;
  required?: boolean;
  className?: string;
  error?: boolean;
  errorMessage?: string;
  "aria-invalid"?: boolean;
  "aria-errormessage"?: string;
}

function LocationAutocompleteContent({
  id,
  value,
  onChangeAction,
  maxLength = 250,
  required = false,
  className,
  error = false,
  errorMessage,
  "aria-invalid": ariaInvalid,
  "aria-errormessage": ariaErrorMessage,
}: LocationAutocompleteProps) {
  const [query, setQuery] = useState("")
  const [inputValue, setInputValue] = useState(value?.text || "")
  const [showResults, setShowResults] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [predictions, setPredictions] = useState<google.maps.places.AutocompletePrediction[]>([])
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [placesApiReady, setPlacesApiReady] = useState(false)
  
  const autocompleteService = useRef<google.maps.places.AutocompleteService | null>(null)
  const placesService = useRef<google.maps.places.PlacesService | null>(null)
  const searchDebounceRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  const placesInitAttempts = useRef(0)

  // Check if the API is loaded using vis.gl hook
  const isLoaded = useApiIsLoaded();

  // Initialize services when API is loaded
  useEffect(() => {
    // Don't proceed if API isn't loaded at all
    if (!isLoaded) return;
    
    // If services are already initialized, nothing to do
    if (autocompleteService.current && placesService.current) {
      setPlacesApiReady(true);
      return;
    }

    // Check if Places library is available
    if (typeof google !== 'undefined' && google.maps && google.maps.places) {
      try {
        // Initialize services
        autocompleteService.current = new google.maps.places.AutocompleteService();
        
        const attributionNode = document.createElement('div');
        attributionNode.style.display = 'none';
        document.body.appendChild(attributionNode);
        placesService.current = new google.maps.places.PlacesService(attributionNode);
        
        setPlacesApiReady(true);
        console.log('Places API initialized successfully');
      } catch (error) {
        console.error('Error initializing Places services:', error);
        setPlacesApiReady(false);
      }
    } else {
      // Places library not available yet, retry with exponential backoff
      // if we haven't tried too many times already
      if (placesInitAttempts.current < 5) {
        placesInitAttempts.current += 1;
        const delay = Math.pow(2, placesInitAttempts.current) * 100;
        
        console.log(`Places API not available yet. Retrying in ${delay}ms (attempt ${placesInitAttempts.current})`);
        
        setTimeout(() => {
          // Force re-run of this effect
          setPlacesApiReady(prev => prev);
        }, delay);
      } else {
        console.error('Failed to load Places API after multiple attempts');
      }
    }
  }, [isLoaded, placesApiReady]);

  // Update input value when value prop changes
  useEffect(() => {
    setInputValue(value?.text || "")
  }, [value])

  // Search for predictions or show current selection when input is focused
  useEffect(() => {
    if (!isLoaded || !placesApiReady || !autocompleteService.current) return;
    
    if (!query.trim()) {
      // If no query but we have a selected value, create a single prediction for it
      if (value?.text) {
        setPredictions([{
          place_id: 'current-selection',
          description: value.text,
          structured_formatting: {
            main_text: value.text,
            secondary_text: value.display_name || '',
            main_text_matched_substrings: []
          },
          matched_substrings: [],
          terms: [],
          types: []
        }])
      } else {
        setPredictions([])
      }
      return
    }

    if (query.length < 3) {
      setPredictions([])
      return
    }

    // Clear existing timeout
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    searchDebounceRef.current = setTimeout(() => {
      setIsLoading(true)
      autocompleteService.current?.getPlacePredictions(
        {
          input: query,
          types: ['geocode', 'establishment'],
        },
        (results, status) => {
          setIsLoading(false)
          if (status === google.maps.places.PlacesServiceStatus.OK && results) {
            setPredictions(results)
          } else {
            setPredictions([])
          }
        }
      )
    }, 300)

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [query, isLoaded, value, placesApiReady])

  const handleSelect = (prediction: google.maps.places.AutocompletePrediction) => {
    // If selecting the current selection, just close the dropdown
    if (prediction.place_id === 'current-selection') {
      setShowResults(false)
      return
    }

    if (!placesService.current) return
    
    setIsLoading(true)
    placesService.current.getDetails(
      {
        placeId: prediction.place_id,
        fields: ['name', 'formatted_address', 'geometry', 'address_components']
      },
      (place, status) => {
        setIsLoading(false)
        if (status === google.maps.places.PlacesServiceStatus.OK && place && place.geometry?.location) {
          const locationData: LocationData = {
            text: place.name || prediction.description,
            display_name: place.formatted_address || prediction.description,
            coordinates: {
              latitude: place.geometry.location.lat(),
              longitude: place.geometry.location.lng()
            }
          }
          
          setInputValue(locationData.text)
          onChangeAction(locationData)
          setQuery("")
          setShowResults(false)
        }
      }
    )
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    if (newValue.length <= maxLength) {
      setInputValue(newValue)
      setQuery(newValue)
      setShowResults(true)
      // Update parent state immediately for validation, even if it's just text
      onChangeAction(newValue ? { text: newValue, display_name: newValue } : undefined)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showResults || predictions.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex(prev => 
          prev < predictions.length - 1 ? prev + 1 : 0
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex(prev => 
          prev > 0 ? prev - 1 : predictions.length - 1
        )
        break
      case 'Enter':
        e.preventDefault()
        if (focusedIndex >= 0) {
          handleSelect(predictions[focusedIndex])
        }
        break
      case 'Escape':
        setShowResults(false)
        setFocusedIndex(-1)
        break
    }
  }

  // Reset focused index when predictions change
  useEffect(() => {
    setFocusedIndex(-1)
  }, [predictions])

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowResults(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Show loading state when API is not yet loaded or Places API is initializing
  if (!isLoaded || !placesApiReady) {
    return (
      <div className={cn("relative space-y-1.5", className)}>
        <div className="relative">
          <Input
            id={id}
            placeholder="Loading location search..."
            disabled
            className="w-full pl-9"
          />
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("relative space-y-1.5", className)} ref={containerRef}>
      <div className="relative">
        <Input
          id={id}
          placeholder="Search for a location..."
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => {
            setShowResults(true)
            setQuery("") // Clear query on focus to allow re-searching
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            "w-full pl-9",
            error && "border-destructive"
          )}
          maxLength={maxLength}
          required={required}
          aria-invalid={ariaInvalid ?? error}
          aria-errormessage={ariaErrorMessage}
        />
        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
          <Search className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
      
      {showResults && (
        <div className="absolute left-0 right-0 mt-1 rounded-lg border bg-popover shadow-lg z-50">
          <Command>
            <CommandList>
              <CommandEmpty className="p-3 text-center text-sm">
                  {query.length < 3 && query.length > 0 ? (
                    <div className="py-6 text-center flex flex-row justify-center items-center gap-4 px-4">
                      <Search className="h-7 w-7 text-muted-foreground opacity-80 flex-shrink-0" />
                      <div className="text-left">
                      <p className="font-medium">Keep typing to search</p>
                      <p className="text-xs text-muted-foreground">Enter at least 3 characters to search for locations</p>
                      </div>
                    </div>
                    ) : isLoading ? (
                    <div className="py-6 text-center flex flex-row justify-center items-center gap-4 px-4">
                      <Loader2 className="h-7 w-7 animate-spin opacity-80 flex-shrink-0" />
                      <div className="text-left">
                      <p className="font-medium">Searching locations</p>
                      <p className="text-xs text-muted-foreground">Please wait while we find matching locations...</p>
                      </div>
                    </div>
                    ) : (
                    <div className="py-6 text-center flex flex-row justify-center items-center gap-4 px-4">
                      <MapPin className="h-7 w-7 text-muted-foreground opacity-80 flex-shrink-0" />
                      <div className="text-left">
                      <p className="font-medium">No locations found</p>
                      <p className="text-xs text-muted-foreground">Try adjusting your search terms</p>
                      </div>
                    </div>
                    )}
              </CommandEmpty>
              <CommandGroup>
                {predictions.map((prediction, index) => {
                  const isCurrentSelection = prediction.place_id === 'current-selection'
                  return (
                    <CommandItem
                      key={prediction.place_id}
                      value={prediction.place_id}
                      onSelect={() => handleSelect(prediction)}
                      className={cn(
                        "cursor-pointer",
                        focusedIndex === index && "bg-accent",
                        isCurrentSelection && "bg-primary/5"
                      )}
                    >
                      <div className="flex items-center w-full">
                          <MapPin className="mr-2 h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <div className="flex-1 truncate">
                            <p className="truncate">{prediction.structured_formatting.main_text}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {prediction.structured_formatting.secondary_text}
                            </p>
                          </div>
                          {isCurrentSelection && (
                            <Check className="ml-2 h-4 w-4 text-primary flex-shrink-0" />
                          )}
                        </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      )}
    {value?.coordinates && (
          <div className="flex items-center gap-1.5 text-sm text-primary pl-1">
            <Check className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">Address set: {value.display_name}</span>
          </div>
        )}
      {error && errorMessage && (
        <div id={ariaErrorMessage} className="text-destructive text-sm flex items-center gap-1.5 mt-1">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  )
}

// Main export component that wraps the content with APIProvider
export default function LocationAutocomplete(props: LocationAutocompleteProps) {
  return (
    <APIProvider 
      apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ""} 
      libraries={['places']}
    >
      <LocationAutocompleteContent {...props} />
    </APIProvider>
  )
}

