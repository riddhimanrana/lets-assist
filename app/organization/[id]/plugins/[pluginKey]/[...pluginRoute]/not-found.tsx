import Link from "next/link";

export default function OrganizationPluginRouteNotFound() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="rounded-lg border bg-card p-5 text-card-foreground">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This page is unavailable or your account does not have access.
        </p>
        <Link
          href="/organization"
          className="mt-4 inline-flex h-9 items-center justify-center rounded-md border bg-background px-3 text-sm font-medium outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to organizations
        </Link>
      </div>
    </div>
  );
}
