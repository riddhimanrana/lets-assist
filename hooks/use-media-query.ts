"use client";

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  
  useEffect(() => {
    const media = window.matchMedia(query);
    
    // Set initial value
    setMatches(media.matches);
    
    // Define listener function
    const listener = () => {
      setMatches(media.matches);
    };
    
    // Add listener
    window.addEventListener("resize", listener);
    
    // Clean up
    return () => window.removeEventListener("resize", listener);
  }, [query]);
  
  return matches;
}
