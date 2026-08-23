/**
 * Plugin SDK, version 1.
 *
 * The public, server-safe contract between the platform and a plugin. Every
 * export here is serializable data or a pure function over it. Nothing in this
 * directory may import React, Next.js, Supabase, or any host module: the SDK is
 * meant to be consumable by a plugin that deploys as its own application, and
 * `sdk-purity.test.ts` enforces that boundary mechanically.
 */

export * from "./compatibility";
export * from "./declarations";
export * from "./lifecycle";
export * from "./manifest";
export * from "./release";
export * from "./runtime-profile";
export * from "./schema";
export * from "./storage-path";
