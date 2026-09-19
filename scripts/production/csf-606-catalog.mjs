// Signed release publication updates only the plugin catalog. It leaves the
// reviewed schema catalog from the atomic post and attachment migration intact.
export function csf606Catalog(previous) {
  return previous;
}
