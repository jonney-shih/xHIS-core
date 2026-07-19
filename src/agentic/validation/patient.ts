import { err, ok, type Result } from '../../core/execution/result.js';
import { encounterId, isoTimestamp, patientId } from '../../instructions/patient/ids.js';
import type { PatientInstruction } from '../../instructions/patient/types.js';
import { isIsoTimestamp, isNonEmptyString } from './guards.js';
import type { InstructionValidatorRegistry } from './validator.js';

type AdmitPatient = Extract<PatientInstruction, { kind: 'AdmitPatient' }>;
type DischargePatient = Extract<PatientInstruction, { kind: 'DischargePatient' }>;

// `candidate`'s `kind` field has already been matched to this key by
// `validateInstruction`'s dispatch — same "exact string key lookup is
// precise" guarantee `HandlerRegistry` dispatch relies on — so it's
// reconstructed as the literal below rather than re-read from `candidate`.
export function validateAdmitPatient(candidate: unknown): Result<AdmitPatient, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['patientId'])) issues.push("'patientId' must be a non-empty string");
  if (!isNonEmptyString(c['encounterId'])) issues.push("'encounterId' must be a non-empty string");
  if (!isIsoTimestamp(c['admittedAt'])) issues.push("'admittedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'AdmitPatient',
    patientId: patientId(c['patientId'] as string),
    encounterId: encounterId(c['encounterId'] as string),
    admittedAt: isoTimestamp(c['admittedAt'] as string),
  });
}

function validateDischargePatient(candidate: unknown): Result<DischargePatient, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['encounterId'])) issues.push("'encounterId' must be a non-empty string");
  if (!isIsoTimestamp(c['dischargedAt'])) issues.push("'dischargedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'DischargePatient',
    encounterId: encounterId(c['encounterId'] as string),
    dischargedAt: isoTimestamp(c['dischargedAt'] as string),
  });
}

/**
 * Assembled as a single object literal checked with `satisfies` — see
 * __typetests__/exhaustiveness.ts for the compile-time proof that this is
 * total over `PatientInstruction`.
 */
export const patientInstructionValidators = {
  AdmitPatient: validateAdmitPatient,
  DischargePatient: validateDischargePatient,
} satisfies InstructionValidatorRegistry<PatientInstruction>;
