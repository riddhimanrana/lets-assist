import type { OrganizationPluginDefinition } from "@/types";

// IMPORT YOUR PRIVATE PLUGINS HERE
import { dvSpeechDebatePluginDefinition } from "@/lib/plugins/private/dv-speech-debate/plugin";

/**
 * Registry of all private/paid plugins attached to this environment.
 * Because this file is committed, DO NOT commit your actual plugin files or folders here.
 * Instead, map them below. If the folder doesn't exist locally, it will fail to compile,
 * so developers on the public repo will just see this empty array.
 */
export const privatePlugins: OrganizationPluginDefinition[] = [
  dvSpeechDebatePluginDefinition
];
