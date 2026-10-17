import { err, ok, type Result } from '../../core/execution/result.js';
import { cpoeOrderId, encounterId, isoTimestamp, patientId, soapNoteId, staffId } from '../../instructions/outpatient/ids.js';
import type { CpoeOrderDetail, OutpatientInstruction } from '../../instructions/outpatient/types.js';
import { isIsoTimestamp, isNonEmptyString } from './guards.js';
import type { InstructionValidatorRegistry } from './validator.js';

type CheckInPatient = Extract<OutpatientInstruction, { kind: 'CheckInPatient' }>;
type RecordSoapNote = Extract<OutpatientInstruction, { kind: 'RecordSoapNote' }>;
type FinalizeSoapNote = Extract<OutpatientInstruction, { kind: 'FinalizeSoapNote' }>;
type PlaceCpoeOrder = Extract<OutpatientInstruction, { kind: 'PlaceCpoeOrder' }>;
type CompleteEncounter = Extract<OutpatientInstruction, { kind: 'CompleteEncounter' }>;

export function validateCheckInPatient(candidate: unknown): Result<CheckInPatient, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['encounterId'])) issues.push("'encounterId' must be a non-empty string");
  if (!isNonEmptyString(c['patientId'])) issues.push("'patientId' must be a non-empty string");
  if (!isIsoTimestamp(c['checkedInAt'])) issues.push("'checkedInAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'CheckInPatient',
    encounterId: encounterId(c['encounterId'] as string),
    patientId: patientId(c['patientId'] as string),
    checkedInAt: isoTimestamp(c['checkedInAt'] as string),
  });
}

export function validateRecordSoapNote(candidate: unknown): Result<RecordSoapNote, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['noteId'])) issues.push("'noteId' must be a non-empty string");
  if (!isNonEmptyString(c['encounterId'])) issues.push("'encounterId' must be a non-empty string");
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
    kind: 'RecordSoapNote',
    noteId: soapNoteId(c['noteId'] as string),
    encounterId: encounterId(c['encounterId'] as string),
    authorStaffId: staffId(c['authorStaffId'] as string),
    subjective: c['subjective'] as string,
    objective: c['objective'] as string,
    assessment: c['assessment'] as string,
    plan: c['plan'] as string,
    recordedAt: isoTimestamp(c['recordedAt'] as string),
  });
}

export function validateFinalizeSoapNote(candidate: unknown): Result<FinalizeSoapNote, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['noteId'])) issues.push("'noteId' must be a non-empty string");
  if (!isIsoTimestamp(c['finalizedAt'])) issues.push("'finalizedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'FinalizeSoapNote',
    noteId: soapNoteId(c['noteId'] as string),
    finalizedAt: isoTimestamp(c['finalizedAt'] as string),
  });
}

/**
 * Checks the same level of thing every other field check in this file
 * does — is it the right *shape* for its declared `orderType` — not
 * whether that order actually makes clinical sense; that's a future
 * relay's/target domain's own concern once one exists (see
 * `placeCpoeOrderHandler`'s doc comment), the same division of labor
 * `ledger.ts`'s `isValidLineShape` already establishes between
 * validator and handler.
 */
function isValidCpoeOrderDetail(candidate: unknown): candidate is CpoeOrderDetail {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const detail = candidate as Record<string, unknown>;
  switch (detail['orderType']) {
    case 'lab':
      return isNonEmptyString(detail['testCode']);
    case 'imaging':
      return isNonEmptyString(detail['modality']);
    case 'pharmacy':
      return isNonEmptyString(detail['medicationCode']);
    default:
      return false;
  }
}

export function validatePlaceCpoeOrder(candidate: unknown): Result<PlaceCpoeOrder, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['orderId'])) issues.push("'orderId' must be a non-empty string");
  if (!isNonEmptyString(c['encounterId'])) issues.push("'encounterId' must be a non-empty string");

  const rawDetail = c['detail'];
  if (!isValidCpoeOrderDetail(rawDetail)) {
    issues.push(
      "'detail' must be { orderType: 'lab', testCode: non-empty string } | { orderType: 'imaging', modality: non-empty string } | { orderType: 'pharmacy', medicationCode: non-empty string }",
    );
  }

  if (!isIsoTimestamp(c['placedAt'])) issues.push("'placedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'PlaceCpoeOrder',
    orderId: cpoeOrderId(c['orderId'] as string),
    encounterId: encounterId(c['encounterId'] as string),
    detail: rawDetail as CpoeOrderDetail,
    placedAt: isoTimestamp(c['placedAt'] as string),
  });
}

export function validateCompleteEncounter(candidate: unknown): Result<CompleteEncounter, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['encounterId'])) issues.push("'encounterId' must be a non-empty string");
  if (!isIsoTimestamp(c['completedAt'])) issues.push("'completedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'CompleteEncounter',
    encounterId: encounterId(c['encounterId'] as string),
    completedAt: isoTimestamp(c['completedAt'] as string),
  });
}

/**
 * Assembled as a single object literal checked with `satisfies` — see
 * __typetests__/outpatient.exhaustiveness.ts for the compile-time proof
 * that this is total over `OutpatientInstruction`.
 */
export const outpatientInstructionValidators = {
  CheckInPatient: validateCheckInPatient,
  RecordSoapNote: validateRecordSoapNote,
  FinalizeSoapNote: validateFinalizeSoapNote,
  PlaceCpoeOrder: validatePlaceCpoeOrder,
  CompleteEncounter: validateCompleteEncounter,
} satisfies InstructionValidatorRegistry<OutpatientInstruction>;
