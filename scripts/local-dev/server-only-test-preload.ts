// Next's server always loads this baseline before anything else
// (node-environment.js). Under Bun it is the only thing that puts a real
// AsyncLocalStorage on globalThis. Next's request stores capture that global
// once, when they first load, and keep a process-wide singleton. Without the
// baseline, whichever test file first imports next/headers, next/cache or
// next/server leaves a fake store for every later file in the same process.
// Once a later file loads Next's server environment, its console patch routes
// every console call through that fake and throws. Loading the baseline here
// gives tests the same runtime Next itself provides.
import "next/dist/server/node-environment-baseline.js";

import { mock } from "bun:test";

// `server-only` is a build-time boundary marker that intentionally throws in
// plain runtimes. Bun unit tests exercise server modules directly, so replace
// only the marker while leaving every real server dependency intact.
mock.module("server-only", () => ({}));
