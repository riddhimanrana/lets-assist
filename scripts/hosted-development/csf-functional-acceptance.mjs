export function hostedAcceptanceMode(value = "full") {
  if (value !== "full" && value !== "functional")
    throw new Error("Hosted acceptance mode must be full or functional.");
  return value;
}

export function passesHostedFunctionalAcceptance(result) {
  return (
    result.distinctAuthIdentities === 2 &&
    result.distinctAuthSessions === 2 &&
    result.reviewNavigationCount === 25 &&
    result.mutationCount === 30 &&
    result.browserErrors === 0
  );
}
