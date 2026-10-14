// The public SignUpGenius pages the provider column was checked against.
const PROVIDER_SOURCES_CHECKED = "October 12, 2026";
const providerSources = [
  {
    label: "Hours report",
    href: "https://support.signupgenius.com/hc/en-us/articles/29670376445335-Track-Volunteer-Hours-with-a-Report",
  },
  {
    label: "Product overview",
    href: "https://www.signupgenius.com/videos/what-is-signupgenius",
  },
  {
    label: "Sign-up features",
    href: "https://www.signupgenius.com/sign-ups",
  },
];

export function ComparisonSources() {
  return (
    <p
      id="comparison-sources"
      className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground"
    >
      SignUpGenius column checked against its public pages on{" "}
      {PROVIDER_SOURCES_CHECKED}. Plans and features change, so confirm with the
      provider:{" "}
      {providerSources.map((source, i) => (
        <span key={source.href}>
          {i > 0 ? ", " : null}
          <a
            href={source.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline underline-offset-4 hover:no-underline"
          >
            {source.label}
          </a>
        </span>
      ))}
      .
    </p>
  );
}
