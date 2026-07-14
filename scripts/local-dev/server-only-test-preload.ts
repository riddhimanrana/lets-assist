import { mock } from "bun:test";

// `server-only` is a build-time boundary marker that intentionally throws in
// plain runtimes. Bun unit tests exercise server modules directly, so replace
// only the marker while leaving every real server dependency intact.
mock.module("server-only", () => ({}));
