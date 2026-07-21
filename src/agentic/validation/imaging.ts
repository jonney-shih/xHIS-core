import { err, ok, type Result } from '../../core/execution/result.js';
import { encounterId, isoTimestamp, studyId } from '../../instructions/imaging/ids.js';
import type { ImagingInstruction } from '../../instructions/imaging/types.js';
import { isIsoTimestamp, isNonEmptyString } from './guards.js';
import type { InstructionValidatorRegistry } from './validator.js';

type OrderStudy = Extract<ImagingInstruction, { kind: 'OrderStudy' }>;
type RecordStudyStored = Extract<ImagingInstruction, { kind: 'RecordStudyStored' }>;
type ReportStudy = Extract<ImagingInstruction, { kind: 'ReportStudy' }>;
type CancelStudy = Extract<ImagingInstruction, { kind: 'CancelStudy' }>;

export function validateOrderStudy(candidate: unknown): Result<OrderStudy, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['studyId'])) issues.push("'studyId' must be a non-empty string");
  if (!isNonEmptyString(c['encounterId'])) issues.push("'encounterId' must be a non-empty string");
  if (!isNonEmptyString(c['modality'])) issues.push("'modality' must be a non-empty string");
  if (!isIsoTimestamp(c['orderedAt'])) issues.push("'orderedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'OrderStudy',
    studyId: studyId(c['studyId'] as string),
    encounterId: encounterId(c['encounterId'] as string),
    modality: c['modality'] as string,
    orderedAt: isoTimestamp(c['orderedAt'] as string),
  });
}

export function validateRecordStudyStored(candidate: unknown): Result<RecordStudyStored, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['studyId'])) issues.push("'studyId' must be a non-empty string");
  if (!isNonEmptyString(c['storageRef'])) issues.push("'storageRef' must be a non-empty string");
  if (!isIsoTimestamp(c['performedAt'])) issues.push("'performedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'RecordStudyStored',
    studyId: studyId(c['studyId'] as string),
    storageRef: c['storageRef'] as string,
    performedAt: isoTimestamp(c['performedAt'] as string),
  });
}

export function validateReportStudy(candidate: unknown): Result<ReportStudy, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['studyId'])) issues.push("'studyId' must be a non-empty string");
  if (!isNonEmptyString(c['reportText'])) issues.push("'reportText' must be a non-empty string");
  if (!isIsoTimestamp(c['reportedAt'])) issues.push("'reportedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'ReportStudy',
    studyId: studyId(c['studyId'] as string),
    reportText: c['reportText'] as string,
    reportedAt: isoTimestamp(c['reportedAt'] as string),
  });
}

function validateCancelStudy(candidate: unknown): Result<CancelStudy, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['studyId'])) issues.push("'studyId' must be a non-empty string");
  if (!isIsoTimestamp(c['cancelledAt'])) issues.push("'cancelledAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'CancelStudy',
    studyId: studyId(c['studyId'] as string),
    cancelledAt: isoTimestamp(c['cancelledAt'] as string),
  });
}

/**
 * Assembled as a single object literal checked with `satisfies` — see
 * __typetests__/imaging.exhaustiveness.ts for the compile-time proof that
 * this is total over `ImagingInstruction`.
 */
export const imagingInstructionValidators = {
  OrderStudy: validateOrderStudy,
  RecordStudyStored: validateRecordStudyStored,
  ReportStudy: validateReportStudy,
  CancelStudy: validateCancelStudy,
} satisfies InstructionValidatorRegistry<ImagingInstruction>;
