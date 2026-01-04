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

// Calendar types
export * from './calendar';
