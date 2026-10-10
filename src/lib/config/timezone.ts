/**
 * Workspace time zone (P1-E7): an IANA identifier such as "UTC",
 * "Europe/London" or "America/Chicago". The list comes from the runtime's
 * Intl data (no hand-maintained list). New and existing workspaces use UTC
 * until an owner or admin chooses another zone; the browser's zone is never
 * stored implicitly.
 */

export const DEFAULT_TIMEZONE = "UTC";

let zones: Set<string> | null = null;

/** IANA zones the runtime knows, UTC first. */
export function timeZoneOptions(): string[] {
  return [DEFAULT_TIMEZONE, ...Intl.supportedValuesOf("timeZone").filter((z) => z !== DEFAULT_TIMEZONE)];
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length < 1 || tz.length > 64) return false;
  zones ??= new Set(timeZoneOptions());
  return zones.has(tz);
}
