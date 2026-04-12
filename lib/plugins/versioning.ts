function normalizeVersion(version: string | null | undefined): string {
  if (!version) return "0.0.0";
  const trimmed = version.trim().toLowerCase();
  return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
}

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
};

function parseVersion(version: string | null | undefined): ParsedVersion {
  const normalized = normalizeVersion(version);
  const [majorRaw, minorRaw, patchRaw] = normalized.split(".");

  const major = Number.parseInt(majorRaw ?? "0", 10);
  const minor = Number.parseInt(minorRaw ?? "0", 10);
  const patch = Number.parseInt((patchRaw ?? "0").split("-")[0], 10);

  return {
    major: Number.isFinite(major) ? major : 0,
    minor: Number.isFinite(minor) ? minor : 0,
    patch: Number.isFinite(patch) ? patch : 0,
  };
}

export function comparePluginVersions(a: string | null | undefined, b: string | null | undefined): number {
  const left = parseVersion(a);
  const right = parseVersion(b);

  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;

  return 0;
}

export function isPluginVersionBehind(current: string | null | undefined, target: string | null | undefined): boolean {
  return comparePluginVersions(current, target) < 0;
}

export function coalescePluginVersion(primary: string | null | undefined, fallback: string | null | undefined): string {
  const normalizedPrimary = normalizeVersion(primary);
  if (normalizedPrimary && normalizedPrimary !== "0.0.0") {
    return normalizedPrimary;
  }

  const normalizedFallback = normalizeVersion(fallback);
  return normalizedFallback || "0.0.0";
}