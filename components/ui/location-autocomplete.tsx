"use client"

import * as React from "react"
import { useState, useRef } from "react"
import { Check, MapPin, Search, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { useLoadScript } from "@react-google-maps/api"
import { LocationData } from "@/types"

const libraries = ["places"]

interface LocationAutocompleteProps {
  value?: LocationData;
  onChange: (location?: LocationData) => void;
  maxLength?: number;
  required?: boolean;
  className?: string;
}

export default function LocationAutocomplete({ 
  value,
  onChange,
  maxLength = 100,
  required = false,
  className 
}: LocationAutocompleteProps) {
  const [query, setQuery] = useState("")
  const [inputValue, setInputValue] = useState(value?.text || "")
  const [showResults, setShowResults] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [predictions, setPredictions] = useState<google.maps.places.AutocompletePrediction[]>([])
  const [focusedIndex, setFocusedIndex] = useState(-1)
  
  const autocompleteService = useRef<google.maps.places.AutocompleteService | null>(null)
  const placesService = useRef<google.maps.places.PlacesService | null>(null)
  const searchDebounceRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)

  // Load Google Maps script
  const { isLoaded } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    libraries: libraries as any,
  })

  // Initialize services when script is loaded
  React.useEffect(() => {
    if (isLoaded && !autocompleteService.current) {
      autocompleteService.current = new google.maps.places.AutocompleteService()
      
      const attributionNode = document.createElement('div')
      attributionNode.style.display = 'none'
      document.body.appendChild(attributionNode)
      placesService.current = new google.maps.places.PlacesService(attributionNode)
    }
  }, [isLoaded])

  // Update input value when value prop changes
  React.useEffect(() => {
    setInputValue(value?.text || "")
  }, [value])

  // Search for predictions or show current selection when input is focused
  React.useEffect(() => {
    if (!isLoaded || !autocompleteService.current) return
    
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
  }, [query, isLoaded, value])

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
          onChange(locationData)
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
      onChange(newValue ? { text: newValue, display_name: newValue } : undefined)
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
  React.useEffect(() => {
    setFocusedIndex(-1)
  }, [predictions])

  // Click outside handler
  React.useEffect(() => {
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

  const getCounterColor = (current: number, max: number) => {
    const percentage = (current / max) * 100
    if (percentage >= 90) return "text-destructive"
    if (percentage >= 75) return "text-yellow-500"
    return "text-muted-foreground"
  }

  return (
    <div className={cn("space-y-2", className)} ref={containerRef}>
      <div className="flex justify-between items-baseline">
        <Label>Location</Label>
        <span
          className={cn(
            "text-xs transition-colors",
            getCounterColor(inputValue.length, maxLength)
          )}
        >
          {inputValue.length}/{maxLength}
        </span>
      </div>
      
      <div className="relative space-y-1.5">
        <div className="relative">
          <Input
            placeholder="Search for a location..."
            value={inputValue}
            onChange={handleInputChange}
            onFocus={() => {
              setShowResults(true)
              setQuery("")
            }}
            onKeyDown={handleKeyDown}
            className="w-full pl-9"
            maxLength={maxLength}
            required={required}
          />
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            <Search className="h-4 w-4 text-muted-foreground" />
          </div>
          {/* {isLoading && (
            <div className="absolute inset-y-0 right-0 flex items-center pr-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )} */}
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
      </div>
    </div>
  )
}

