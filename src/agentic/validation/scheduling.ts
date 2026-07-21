import { err, ok, type Result } from '../../core/execution/result.js';
import { bookingId, isoTimestamp, resourceId } from '../../instructions/scheduling/ids.js';
import type { SchedulingInstruction } from '../../instructions/scheduling/types.js';
import { isIsoTimestamp, isNonEmptyString } from './guards.js';
import type { InstructionValidatorRegistry } from './validator.js';

type ScheduleBooking = Extract<SchedulingInstruction, { kind: 'ScheduleBooking' }>;
type CancelBooking = Extract<SchedulingInstruction, { kind: 'CancelBooking' }>;

export function validateScheduleBooking(candidate: unknown): Result<ScheduleBooking, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['bookingId'])) issues.push("'bookingId' must be a non-empty string");
  if (!isNonEmptyString(c['resourceId'])) issues.push("'resourceId' must be a non-empty string");
  if (!isNonEmptyString(c['subjectId'])) issues.push("'subjectId' must be a non-empty string");
  if (!isIsoTimestamp(c['startAt'])) issues.push("'startAt' must be an ISO-8601 timestamp string");
  if (!isIsoTimestamp(c['endAt'])) issues.push("'endAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'ScheduleBooking',
    bookingId: bookingId(c['bookingId'] as string),
    resourceId: resourceId(c['resourceId'] as string),
    subjectId: c['subjectId'] as string,
    startAt: isoTimestamp(c['startAt'] as string),
    endAt: isoTimestamp(c['endAt'] as string),
  });
}

function validateCancelBooking(candidate: unknown): Result<CancelBooking, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['bookingId'])) issues.push("'bookingId' must be a non-empty string");
  if (!isIsoTimestamp(c['cancelledAt'])) issues.push("'cancelledAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'CancelBooking',
    bookingId: bookingId(c['bookingId'] as string),
    cancelledAt: isoTimestamp(c['cancelledAt'] as string),
  });
}

/**
 * Assembled as a single object literal checked with `satisfies` — see
 * __typetests__/scheduling.exhaustiveness.ts for the compile-time proof
 * that this is total over `SchedulingInstruction`.
 */
export const schedulingInstructionValidators = {
  ScheduleBooking: validateScheduleBooking,
  CancelBooking: validateCancelBooking,
} satisfies InstructionValidatorRegistry<SchedulingInstruction>;
