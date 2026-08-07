import { err, ok, type Result } from '../../core/execution/result.js';
import { encounterId, isoTimestamp, prescriptionId } from '../../instructions/pharmacy/ids.js';
import type { PharmacyInstruction } from '../../instructions/pharmacy/types.js';
import { isIsoTimestamp, isNonEmptyString } from './guards.js';
import type { InstructionValidatorRegistry } from './validator.js';

type PrescribeMedication = Extract<PharmacyInstruction, { kind: 'PrescribeMedication' }>;
type DispenseMedication = Extract<PharmacyInstruction, { kind: 'DispenseMedication' }>;

export function validatePrescribeMedication(candidate: unknown): Result<PrescribeMedication, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['prescriptionId'])) issues.push("'prescriptionId' must be a non-empty string");
  if (!isNonEmptyString(c['encounterId'])) issues.push("'encounterId' must be a non-empty string");
  if (!isNonEmptyString(c['medicationCode'])) issues.push("'medicationCode' must be a non-empty string");
  if (!isIsoTimestamp(c['prescribedAt'])) issues.push("'prescribedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'PrescribeMedication',
    prescriptionId: prescriptionId(c['prescriptionId'] as string),
    encounterId: encounterId(c['encounterId'] as string),
    medicationCode: c['medicationCode'] as string,
    prescribedAt: isoTimestamp(c['prescribedAt'] as string),
  });
}

function validateDispenseMedication(candidate: unknown): Result<DispenseMedication, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['prescriptionId'])) issues.push("'prescriptionId' must be a non-empty string");
  if (!isIsoTimestamp(c['dispensedAt'])) issues.push("'dispensedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'DispenseMedication',
    prescriptionId: prescriptionId(c['prescriptionId'] as string),
    dispensedAt: isoTimestamp(c['dispensedAt'] as string),
  });
}

/**
 * Assembled as a single object literal checked with `satisfies` — see
 * __typetests__/pharmacy.exhaustiveness.ts for the compile-time proof that
 * this is total over `PharmacyInstruction`.
 */
export const pharmacyInstructionValidators = {
  PrescribeMedication: validatePrescribeMedication,
  DispenseMedication: validateDispenseMedication,
} satisfies InstructionValidatorRegistry<PharmacyInstruction>;
