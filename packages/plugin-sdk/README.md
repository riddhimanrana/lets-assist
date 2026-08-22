# Let's Assist plugin SDK

This package contains the serializable contract shared by the Let's Assist host
and independently deployed plugin applications. It includes manifest
validation, compatibility checks, lifecycle messages, release identity types,
runtime-profile declarations, and Storage path builders.

The package contains no host components, Server Actions, Supabase client, or
private plugin code. A child application still has to verify the Supabase
session and current organization access inside its own server boundary.

Releases use the `plugin-sdk/v<version>` tag family. Each GitHub release carries
the package tarball, a CycloneDX SBOM, a source and build manifest, a Sigstore
bundle, and SHA-256 checksums. Consumers pin the release tarball in `bun.lock`.
The package's own lockfile is part of the signed source inputs and supplies the
dependency closure recorded in the SBOM.
