export function organizationCanonicalUrl(
  username: string,
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) {
      query.append(key, entry);
    }
  }
  const suffix = query.toString();
  const path = `/organization/${encodeURIComponent(username)}`;
  return suffix ? `${path}?${suffix}` : path;
}
