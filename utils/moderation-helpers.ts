import words from 'profane-words';

/**
 * Fast profanity check using local word list and vector.profanity.dev as fallback
 */
export async function checkOffensiveLanguage(text: string): Promise<{ isProfane: boolean; error?: string }> {
  if (!text || text.trim() === "") {
    return { isProfane: false };
  }

  const normalizedText = text.toLowerCase().trim();

  // 1. Check local word list (very fast, works for single words)
  // We use word boundaries to allow names that might contain offensive 
  // substrings (the "Scunthorpe problem"), e.g., "toshitchowda".
  const isLocalProfane = words.some(word => {
    if (word.length < 3) return false; 
    
    // Check if the word exists as a standalone word or separated by non-letters
    // This blocks "shit", "shit123", "mr_shit", but allows "toshitchowda"
    const regex = new RegExp(`(?:^|[^a-z])${word}(?:[^a-z]|$)`, 'i');
    return regex.test(normalizedText);
  });

  if (isLocalProfane) {
    return { 
      isProfane: true, 
      error: "This content contains inappropriate language" 
    };
  }

  // 2. Fallback to API check for complex/multi-word strings
  try {
    const response = await fetch("https://vector.profanity.dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });

    if (!response.ok) {
      // Fail open if the service is down
      return { isProfane: false };
    }

    const result = await response.json();
    
    if (result.isProfanity) {
      return { 
        isProfane: true, 
        error: "This content contains inappropriate language" 
      };
    }

    return { isProfane: false };
  } catch (error) {
    console.error("Profanity check error:", error);
    // Fail open
    return { isProfane: false };
  }
}
