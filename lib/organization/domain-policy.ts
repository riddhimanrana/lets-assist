const PUBLIC_EMAIL_DOMAINS = new Set([
  "aol.com",
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mail.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
  "ymail.com",
]);

const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u;

export type OrganizationDomainPolicyResult =
  | { ok: true; domain: string }
  | { ok: false; reason: "invalid" | "public_provider" };

export function validateOrganizationAutojoinDomain(
  input: string,
): OrganizationDomainPolicyResult {
  const domain = input.trim().toLowerCase();

  if (
    domain.length === 0 ||
    domain.length > 253 ||
    !DOMAIN_PATTERN.test(domain)
  ) {
    return { ok: false, reason: "invalid" };
  }

  if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
    return { ok: false, reason: "public_provider" };
  }

  return { ok: true, domain };
}
