/**
 * Barrel export for all types.
 * Types are organized by domain in separate files for maintainability.
 * Import from '@/types' for convenience, or directly from domain files for tree-shaking.
 */

// Common types (enums, base types)
export * from './common';

// Schedule types
export * from './schedule';

// Profile types
export * from './profile';

// Organization types
export * from './organization';

// Project types
export * from './project';

// Signup types
export * from './signup';

// SignUpGenius integration types
export * from './signupgenius';

// Calendar types
export * from './calendar';

// Waiver types
export * from './waiver';

// Waiver Definitions types (Phase 1: Multi-signer system)
export * from './waiver-definitions';

// System banner types
export * from './system-banner';

// Plugin platform types
export * from './plugin';

// Contact import job types
export * from './contact-import';
