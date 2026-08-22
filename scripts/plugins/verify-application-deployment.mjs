import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fail(message) {
  throw new Error(message);
}

function stableVersion(value) {
  return (
    typeof value === "string" &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(value)
  );
}

function sameArtifact(left, right) {
  return (
    left?.format === right?.format &&
    left?.root === right?.root &&
    left?.projectName === right?.projectName &&
    left?.projectId === right?.projectId &&
    left?.organizationId === right?.organizationId &&
    JSON.stringify(left) === JSON.stringify(right)
  );
}

export function verifyApplicationDeployment({
  manifestPath,
  registryPath,
  targetsPath,
  buildPath,
  releaseTag,
  pluginKey,
  environment,
}) {
  const manifest = readJson(manifestPath);
  const registry = readJson(registryPath);
  const targets = readJson(targetsPath);

  if (manifest.pluginKey !== pluginKey || manifest.tag !== releaseTag) {
    fail("Release coordinates do not match the requested deployment.");
  }
  if (
    !stableVersion(manifest.version) ||
    releaseTag !== `${pluginKey}/v${manifest.version}`
  ) {
    fail("Application deployments require an exact stable release tag.");
  }
  if (manifest.runtimeProfile !== "application" || !manifest.signerIdentity) {
    fail(
      "Application deployments require a signed application-profile release.",
    );
  }
  if (
    !["development", "production"].includes(environment) ||
    manifest.buildArtifact?.format !== "vercel-prebuilt-multi-env-v1" ||
    typeof manifest.buildArtifact?.root !== "string" ||
    !manifest.buildArtifact.root.startsWith("apps/") ||
    manifest.buildArtifact.artifacts?.[environment]?.name !==
      `plugin-build-${environment}.tar.gz`
  ) {
    fail(
      "The signed release has no approved build artifact for this environment.",
    );
  }

  const release = registry.find(
    (entry) =>
      entry.pluginKey === pluginKey &&
      entry.version === manifest.version &&
      entry.runtimeProfile === "application",
  );
  if (!release || !release.signer) {
    fail(
      "The signed application release is not published in the host registry.",
    );
  }
  if (
    release.sourceCommit !== manifest.sourceCommit ||
    release.buildDigest !== manifest.buildDigest ||
    release.signer.identity !== manifest.signerIdentity.subject ||
    release.signer.issuer !== manifest.signerIdentity.issuer ||
    release.signer.attestationRef !==
      `github-release:${releaseTag}/release-manifest.sigstore.json` ||
    !sameArtifact(release.buildArtifact, manifest.buildArtifact)
  ) {
    fail("The host registry does not match the signed application release.");
  }

  const target = targets[pluginKey];
  if (
    !target ||
    target.root !== manifest.buildArtifact.root ||
    target.projectName !== manifest.buildArtifact.projectName ||
    target.projectId !== manifest.buildArtifact.projectId ||
    target.organizationId !== manifest.buildArtifact.organizationId ||
    target.routingApplication !== manifest.buildArtifact.projectName
  ) {
    fail("The signed application target is not approved by the host.");
  }

  const digest = `sha256:${createHash("sha256").update(readFileSync(buildPath)).digest("hex")}`;
  if (digest !== manifest.buildArtifact.artifacts[environment].digest) {
    fail("The application build digest does not match the signed manifest.");
  }

  return {
    pluginKey,
    version: manifest.version,
    releaseTag,
    sourceCommit: manifest.sourceCommit,
    buildDigest: digest,
    artifactName: manifest.buildArtifact.artifacts[environment].name,
    buildArtifact: manifest.buildArtifact,
  };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail("Expected named deployment verification arguments.");
    }
    values[key.slice(2)] = value;
  }
  return values;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArguments(process.argv.slice(2));
  const summary = verifyApplicationDeployment({
    manifestPath: args.manifest,
    registryPath: args.registry,
    targetsPath: args.targets,
    buildPath: args.build,
    releaseTag: args.tag,
    pluginKey: args.plugin,
    environment: args.environment,
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
