import { bedId, encounterId, isoTimestamp } from '../../instructions/bed/ids.js';
import type { BedInstruction } from '../../instructions/bed/types.js';
import { err, ok, type Result } from '../../core/execution/result.js';
import { isIsoTimestamp, isNonEmptyString } from './guards.js';
import type { InstructionValidatorRegistry } from './validator.js';

type AssignBed = Extract<BedInstruction, { kind: 'AssignBed' }>;
type ReleaseBed = Extract<BedInstruction, { kind: 'ReleaseBed' }>;

export function validateAssignBed(candidate: unknown): Result<AssignBed, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['bedId'])) issues.push("'bedId' must be a non-empty string");
  if (!isNonEmptyString(c['encounterId'])) issues.push("'encounterId' must be a non-empty string");
  if (!isIsoTimestamp(c['assignedAt'])) issues.push("'assignedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'AssignBed',
    bedId: bedId(c['bedId'] as string),
    encounterId: encounterId(c['encounterId'] as string),
    assignedAt: isoTimestamp(c['assignedAt'] as string),
  });
}

function validateReleaseBed(candidate: unknown): Result<ReleaseBed, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['bedId'])) issues.push("'bedId' must be a non-empty string");
  if (!isIsoTimestamp(c['releasedAt'])) issues.push("'releasedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'ReleaseBed',
    bedId: bedId(c['bedId'] as string),
    releasedAt: isoTimestamp(c['releasedAt'] as string),
  });
}

/**
 * Assembled as a single object literal checked with `satisfies` — see
 * __typetests__/bed.exhaustiveness.ts for the compile-time proof that
 * this is total over `BedInstruction`.
 */
export const bedInstructionValidators = {
  AssignBed: validateAssignBed,
  ReleaseBed: validateReleaseBed,
} satisfies InstructionValidatorRegistry<BedInstruction>;
