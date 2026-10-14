type OrganizationIdentity = {
  id: string;
  name: string;
  logo_url: string | null;
};
type CertificateIdentity = {
  organization_name: string | null;
  projects?: {
    organizations?: OrganizationIdentity | OrganizationIdentity[] | null;
  } | null;
};

/** Attach a current logo only when certificate names resolve to one organization. */
export function dashboardOrganizationLogos(
  certificates: CertificateIdentity[],
) {
  const identities = new Map<string, Map<string, string | null>>();
  for (const certificate of certificates) {
    const orgs = certificate.projects?.organizations;
    const org = Array.isArray(orgs)
      ? orgs.length === 1
        ? orgs[0]
        : null
      : orgs;
    if (
      !org ||
      !certificate.organization_name ||
      org.name !== certificate.organization_name
    )
      continue;
    const named = identities.get(org.name) ?? new Map();
    named.set(org.id, org.logo_url);
    identities.set(org.name, named);
  }
  return new Map(
    [...identities].map(([name, orgs]) => [
      name,
      orgs.size === 1 ? [...orgs.values()][0] : null,
    ]),
  );
}
