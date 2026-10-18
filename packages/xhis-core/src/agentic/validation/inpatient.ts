import { err, ok, type Result } from '../../core/execution/result.js';
import { encounterId, isoTimestamp, progressNoteId, staffId, wardAssignmentId } from '../../instructions/inpatient/ids.js';
import type { InpatientInstruction } from '../../instructions/inpatient/types.js';
import { isIsoTimestamp, isNonEmptyString } from './guards.js';
import type { InstructionValidatorRegistry } from './validator.js';

type AssignWard = Extract<InpatientInstruction, { kind: 'AssignWard' }>;
type TransferWard = Extract<InpatientInstruction, { kind: 'TransferWard' }>;
type RecordProgressNote = Extract<InpatientInstruction, { kind: 'RecordProgressNote' }>;
type FinalizeProgressNote = Extract<InpatientInstruction, { kind: 'FinalizeProgressNote' }>;

export function validateAssignWard(candidate: unknown): Result<AssignWard, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['assignmentId'])) issues.push("'assignmentId' must be a non-empty string");
  if (!isNonEmptyString(c['encounterId'])) issues.push("'encounterId' must be a non-empty string");
  if (!isNonEmptyString(c['ward'])) issues.push("'ward' must be a non-empty string");
  if (!isNonEmptyString(c['attendingStaffId'])) issues.push("'attendingStaffId' must be a non-empty string");
  if (!isIsoTimestamp(c['assignedAt'])) issues.push("'assignedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'AssignWard',
    assignmentId: wardAssignmentId(c['assignmentId'] as string),
    encounterId: encounterId(c['encounterId'] as string),
    ward: c['ward'] as string,
    attendingStaffId: staffId(c['attendingStaffId'] as string),
    assignedAt: isoTimestamp(c['assignedAt'] as string),
  });
}

export function validateTransferWard(candidate: unknown): Result<TransferWard, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['newAssignmentId'])) issues.push("'newAssignmentId' must be a non-empty string");
  if (!isNonEmptyString(c['encounterId'])) issues.push("'encounterId' must be a non-empty string");
  if (!isNonEmptyString(c['ward'])) issues.push("'ward' must be a non-empty string");
  if (!isNonEmptyString(c['attendingStaffId'])) issues.push("'attendingStaffId' must be a non-empty string");
  if (!isIsoTimestamp(c['transferredAt'])) issues.push("'transferredAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'TransferWard',
    newAssignmentId: wardAssignmentId(c['newAssignmentId'] as string),
    encounterId: encounterId(c['encounterId'] as string),
    ward: c['ward'] as string,
    attendingStaffId: staffId(c['attendingStaffId'] as string),
    transferredAt: isoTimestamp(c['transferredAt'] as string),
  });
}

export function validateRecordProgressNote(candidate: unknown): Result<RecordProgressNote, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['noteId'])) issues.push("'noteId' must be a non-empty string");
  if (!isNonEmptyString(c['assignmentId'])) issues.push("'assignmentId' must be a non-empty string");
  if (!isNonEmptyString(c['authorStaffId'])) issues.push("'authorStaffId' must be a non-empty string");
  if (!isNonEmptyString(c['subjective'])) issues.push("'subjective' must be a non-empty string");
  if (!isNonEmptyString(c['objective'])) issues.push("'objective' must be a non-empty string");
  if (!isNonEmptyString(c['assessment'])) issues.push("'assessment' must be a non-empty string");
  if (!isNonEmptyString(c['plan'])) issues.push("'plan' must be a non-empty string");
  if (!isIsoTimestamp(c['recordedAt'])) issues.push("'recordedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'RecordProgressNote',
    noteId: progressNoteId(c['noteId'] as string),
    assignmentId: wardAssignmentId(c['assignmentId'] as string),
    authorStaffId: staffId(c['authorStaffId'] as string),
    subjective: c['subjective'] as string,
    objective: c['objective'] as string,
    assessment: c['assessment'] as string,
    plan: c['plan'] as string,
    recordedAt: isoTimestamp(c['recordedAt'] as string),
  });
}

export function validateFinalizeProgressNote(candidate: unknown): Result<FinalizeProgressNote, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['noteId'])) issues.push("'noteId' must be a non-empty string");
  if (!isIsoTimestamp(c['finalizedAt'])) issues.push("'finalizedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'FinalizeProgressNote',
    noteId: progressNoteId(c['noteId'] as string),
    finalizedAt: isoTimestamp(c['finalizedAt'] as string),
  });
}

/**
 * Assembled as a single object literal checked with `satisfies` — see
 * __typetests__/inpatient.exhaustiveness.ts for the compile-time proof
 * that this is total over `InpatientInstruction`.
 */
export const inpatientInstructionValidators = {
  AssignWard: validateAssignWard,
  TransferWard: validateTransferWard,
  RecordProgressNote: validateRecordProgressNote,
  FinalizeProgressNote: validateFinalizeProgressNote,
} satisfies InstructionValidatorRegistry<InpatientInstruction>;
