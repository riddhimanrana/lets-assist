/**
 * The host API version plugins compile and run against.
 *
 * Bumped by the host when the surface a plugin can rely on changes. A release
 * declares the range it works with in `hostApiRange`, and activation refuses a
 * release whose range does not contain this value, so a plugin built for a
 * surface the host no longer offers cannot be activated.
 *
 * Deliberately separate from the platform database schema floor: the API
 * surface and the migration ledger move on independent schedules.
 */
export const PLUGIN_HOST_API_VERSION = "1.0.0";
