export function pausedSpeechDebateCatalog(previousCatalog) {
  return `SELECT CASE WHEN (${previousCatalog.replace(/;\s*$/u, "")}) = 1
AND EXISTS (
  SELECT 1 FROM public.plugins
  WHERE key = 'dv-speech-debate'
    AND NOT is_active
    AND visibility = 'private'
    AND force_update_version IS NULL
) THEN 1 ELSE 0 END AS csf_target_schema_verified;`;
}
