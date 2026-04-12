"use client"

import * as React from "react"
import { useState, useRef, useEffect } from "react"
import { Check, MapPin, Search, Loader2, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { APIProvider } from "@vis.gl/react-google-maps"
import { LocationData } from "@/types"

interface LocationAutocompleteProps {
  id?: string;
  value?: LocationData;
  onChangeAction: (location?: LocationData) => void;
  onFocusAction?: () => void;
  maxLength?: number;
  required?: boolean;
  className?: string;
  highlight?: boolean;
  error?: boolean;
  errorMessage?: string;
  "aria-invalid"?: boolean;
  "aria-errormessage"?: string;
}

function LocationAutocompleteContent({
  id,
  value,
  onChangeAction,
  onFocusAction,
  maxLength = 250,
  required = false,
  className,
  highlight = false,
  error = false,
  errorMessage,
  "aria-invalid": ariaInvalid,
  "aria-errormessage": ariaErrorMessage,
}: LocationAutocompleteProps) {
  type LocationPrediction =
    | { kind: "current-selection"; placePrediction: null }
    | { kind: "suggestion"; placePrediction: google.maps.places.PlacePrediction }

  const [query, setQuery] = useState("")
  const [inputValue, setInputValue] = useState("") // Initialize with empty string instead of undefined
  const [showResults, setShowResults] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [predictions, setPredictions] = useState<LocationPrediction[]>([])
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [placesApiReady, setPlacesApiReady] = useState(false)

  const searchDebounceRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)

  // Update input value when value prop changes, ensuring it's never undefined
  useEffect(() => {
    setInputValue(value?.text || "")
  }, [value])

  useEffect(() => {
    let cancelled = false

    const initializePlacesAPI = async () => {
      try {
        if (typeof google === 'undefined' || !google.maps?.importLibrary) return
        await google.maps.importLibrary('places')
        if (!cancelled) setPlacesApiReady(true)
      } catch (error) {
        console.error('Error loading Places library:', error)
        if (!cancelled) setPlacesApiReady(false)
      }
    }

    void initializePlacesAPI()

    return () => {
      cancelled = true
    }
  }, [])

  // Search for predictions or show current selection when input is focused
  useEffect(() => {
    if (!placesApiReady) return;

    if (!query.trim()) {
      // If no query but we have a selected value, create a single prediction for it
      if (value?.text) {
        setPredictions([{ kind: "current-selection", placePrediction: null }])
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
      void google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: query,
      })
        .then(({ suggestions }) => {
          setPredictions(
            suggestions
              .map((suggestion) => suggestion.placePrediction)
              .filter((placePrediction): placePrediction is google.maps.places.PlacePrediction => Boolean(placePrediction))
              .map((placePrediction) => ({
                kind: "suggestion",
                placePrediction,
              }))
          )
        })
        .catch((error) => {
          console.error('Error fetching autocomplete suggestions:', error)
          setPredictions([])
        })
        .finally(() => {
          setIsLoading(false)
        })
    }, 300)

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [query, value, placesApiReady])

  const handleSelect = async (prediction: LocationPrediction) => {
    // If selecting the current selection, just close the dropdown
    if (prediction.kind === "current-selection") {
      setShowResults(false)
      return
    }

    setIsLoading(true)
    try {
      const place = prediction.placePrediction.toPlace()
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location'],
      })

      if (!place.location) return

      const locationData: LocationData = {
        text: place.displayName || prediction.placePrediction.text.text,
        display_name: place.formattedAddress || prediction.placePrediction.text.text,
        coordinates: {
          latitude: place.location.lat(),
          longitude: place.location.lng(),
        },
      }

      setInputValue(locationData.text)
      onChangeAction(locationData)
      setQuery("")
      setShowResults(false)
    } catch (error) {
      console.error('Error fetching place details:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value.slice(0, maxLength) // Enforce maxLength
    setInputValue(newValue)
    setQuery(newValue)
    setShowResults(true)

    // Only call onChangeAction if the value actually changed
    if (newValue !== value?.text) {
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
  if (!placesApiReady) {
    return (
      <div className={cn("relative space-y-1.5", className)}>
        <div className="relative">
          <Input
            id={id}
            placeholder="Loading location search..."
            disabled
            value="" // Explicitly set value to empty string when loading
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
          value={inputValue} // This will now always be a string
          onChange={handleInputChange}
          onFocus={() => {
            setShowResults(true)
            setQuery("") // Clear query on focus to allow re-searching
            if (onFocusAction) onFocusAction();
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
        
        {highlight && (
          <div className="absolute -top-12 left-0 right-0 flex justify-center animate-bounce z-10">
            <div className="bg-primary text-primary-foreground text-xs font-bold py-1.5 px-3 rounded-full shadow-lg flex items-center gap-1.5 whitespace-nowrap">
              <MapPin className="h-3.5 w-3.5" />
              Please verify/fill the location manually!
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-primary" />
            </div>
          </div>
        )}
      </div>

      {showResults && (
        <div className="absolute left-0 right-0 mt-1 rounded-lg border bg-popover shadow-lg z-50">
          <Command>
            <CommandList>
              <CommandEmpty className="p-3 text-center text-sm">
                {query.length < 3 && query.length > 0 ? (
                  <div className="py-6 text-center flex flex-row justify-center items-center gap-4 px-4">
                    <Search className="h-7 w-7 text-muted-foreground opacity-80 shrink-0" />
                    <div className="text-left">
                      <p className="font-medium">Keep typing to search</p>
                      <p className="text-xs text-muted-foreground">Enter at least 3 characters to search for locations</p>
                    </div>
                  </div>
                ) : isLoading ? (
                  <div className="py-6 text-center flex flex-row justify-center items-center gap-4 px-4">
                    <Loader2 className="h-7 w-7 animate-spin opacity-80 shrink-0" />
                    <div className="text-left">
                      <p className="font-medium">Searching locations</p>
                      <p className="text-xs text-muted-foreground">Please wait while we find matching locations...</p>
                    </div>
                  </div>
                ) : (
                  <div className="py-6 text-center flex flex-row justify-center items-center gap-4 px-4">
                    <MapPin className="h-7 w-7 text-muted-foreground opacity-80 shrink-0" />
                    <div className="text-left">
                      <p className="font-medium">No locations found</p>
                      <p className="text-xs text-muted-foreground">Try adjusting your search terms</p>
                    </div>
                  </div>
                )}
              </CommandEmpty>
              <CommandGroup>
                {predictions.map((prediction, index) => {
                  const isCurrentSelection = prediction.kind === "current-selection"
                  if (isCurrentSelection) {
                    return (
                      <CommandItem
                        key="current-selection"
                        value="current-selection"
                        onSelect={() => handleSelect(prediction)}
                        className={cn(
                          "cursor-pointer py-1.5 px-2",
                          focusedIndex === index && "bg-accent",
                          "bg-primary/5"
                        )}
                      >
                        <div className="flex items-center w-full">
                          <MapPin className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 truncate">
                            <p className="truncate">{value?.text}</p>
                            <p className="text-xs text-muted-foreground truncate">{value?.display_name || ''}</p>
                          </div>
                          <Check className="ml-2 h-4 w-4 text-primary shrink-0" />
                        </div>
                      </CommandItem>
                    )
                  }

                  const placePrediction = prediction.placePrediction
                  if (!placePrediction) return null

                  return (
                    <CommandItem
                      key={placePrediction.text.text}
                      value={placePrediction.text.text}
                      onSelect={() => handleSelect(prediction)}
                      className={cn(
                        "cursor-pointer py-1.5 px-2",
                        focusedIndex === index && "bg-accent",
                      )}
                    >
                      <div className="flex items-center w-full">
                        <MapPin className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 truncate">
                          <p className="truncate">{placePrediction.text.text}</p>
                          <p className="text-xs text-muted-foreground truncate">{''}</p>
                        </div>
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
          <Check className="h-4 w-4 shrink-0" />
          <span className="truncate">Address set: {value.display_name}</span>
        </div>
      )}
      {error && errorMessage && (
        <div id={ariaErrorMessage} className="text-destructive text-sm flex items-center gap-1.5 mt-1">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  )
}

// Main export component that wraps the content with APIProvider
export default function LocationAutocomplete(props: LocationAutocompleteProps) {
  const isE2E =
    process.env.E2E_TEST_MODE === "true" ||
    process.env.NEXT_PUBLIC_E2E_TEST_MODE === "true";

  if (isE2E) {
    return (
      <Input
        id={props.id}
        value={props.value?.text ?? ""}
        placeholder="Enter a location"
        maxLength={props.maxLength}
        required={props.required}
        className={props.className}
        aria-invalid={props["aria-invalid"]}
        aria-errormessage={props["aria-errormessage"]}
        onFocus={props.onFocusAction}
        onChange={(event) =>
          props.onChangeAction({
            text: event.target.value,
            display_name: event.target.value,
            coordinates: { latitude: 0, longitude: 0 },
          })
        }
      />
    );
  }

  return (
    <APIProvider
      apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ""}
      libraries={['places']}
    >
      <LocationAutocompleteContent {...props} />
    </APIProvider>
  )
}

