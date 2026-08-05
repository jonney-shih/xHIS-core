/**
 * Domain-agnostic shape checks shared by every domain's instruction
 * validators (see `patient.ts` for the first concrete use). Kept dependency-
 * free and regex-based — no `Date` parsing, so this stays trivially
 * reviewable and never brushes up against the determinism guard's banned
 * identifiers, even though this directory isn't one the guard scans.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

/** Checks the *shape* of an ISO-8601 UTC timestamp string — not whether it
 * names a real calendar date (no `Date` parsing is involved). */
export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIMESTAMP_PATTERN.test(value);
}
