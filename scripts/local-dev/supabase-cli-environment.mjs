// The local resource oracle covers Supabase CLI's legacy Docker backend only.
// v2.120.0 shared/cli/run.ts also enables tracing for legacy commands.
/**
 * @param {Record<string, string | undefined>} environment
 * @param {string} [localProjectId]
 */
export function supabaseCliEnvironment(
  environment = process.env,
  localProjectId,
) {
  /** @type {Record<string, string | undefined>} */
  const result = { ...environment, SUPABASE_EXPERIMENTAL_STACK: "0" };
  delete result.SUPABASE_TRACE_FILE;
  delete result.SUPABASE_OTLP_ENDPOINT;
  delete result.SUPABASE_OTLP_HEADERS;
  if (localProjectId !== undefined) {
    result.SUPABASE_PROJECT_ID = localProjectId;
    result.SUPABASE_NETWORK_ID = "";
    delete result.SUPABASE_WORKDIR;
  }
  return result;
}
