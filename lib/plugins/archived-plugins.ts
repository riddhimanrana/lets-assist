/** Historical code and data remain, but these plugins are no longer offered. */
export function isArchivedPlugin(key: string): boolean {
  return key.trim().toLowerCase() === "dv-speech-debate";
}
