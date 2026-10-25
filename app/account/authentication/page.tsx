import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Google sign-in and two-factor settings now live on /account/security. This
 * route stays alive for old links and for the Google link callback, which
 * still returns here with ?success=linked or ?error=linking_failed, so the
 * query string is carried over.
 */
export default async function AuthenticationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      query.set(key, value);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        query.append(key, entry);
      }
    }
  }

  const queryString = query.toString();
  redirect(
    queryString ? `/account/security?${queryString}` : "/account/security",
  );
}
