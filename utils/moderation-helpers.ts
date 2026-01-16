/**
 * Fast profanity check using vector.profanity.dev
 */
export async function checkOffensiveLanguage(text: string): Promise<{ isProfane: boolean; error?: string }> {
  if (!text || text.trim() === "") {
    return { isProfane: false };
  }

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
