const MFA_PROTECTED_PATH_PREFIXES = ["/organization", "/projects", "/trusted-member"];

export function isMfaProtectedPath(path: string): boolean {
  return MFA_PROTECTED_PATH_PREFIXES.some(
    (protectedPath) =>
      path === protectedPath || path.startsWith(`${protectedPath}/`),
  );
}