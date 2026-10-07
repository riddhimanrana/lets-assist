import { safeConsole } from "@/lib/safe-console";

export const logSignupClientDebug = (payload: Record<string, unknown>) => {
  safeConsole.log("[signup-client-debug]", JSON.stringify(payload));
};
