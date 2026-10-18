import { err, ok, type Result } from '../../core/execution/result.js';
import { emergencyVisitId, encounterId, isoTimestamp, patientId } from '../../instructions/emergency/ids.js';
import type { EmergencyInstruction, EsiLevel } from '../../instructions/emergency/types.js';
import { isIsoTimestamp, isNonEmptyString } from './guards.js';
import type { InstructionValidatorRegistry } from './validator.js';

type RegisterEdVisit = Extract<EmergencyInstruction, { kind: 'RegisterEdVisit' }>;
type TriagePatient = Extract<EmergencyInstruction, { kind: 'TriagePatient' }>;
type DispositionPatient = Extract<EmergencyInstruction, { kind: 'DispositionPatient' }>;

const VALID_ESI_LEVELS: readonly EsiLevel[] = [1, 2, 3, 4, 5];

function isEsiLevel(value: unknown): value is EsiLevel {
  return typeof value === 'number' && (VALID_ESI_LEVELS as readonly number[]).includes(value);
}

const VALID_DISPOSITIONS = ['admitted', 'discharged', 'transferred', 'left-without-being-seen'] as const;

function isDisposition(value: unknown): value is DispositionPatient['disposition'] {
  return (VALID_DISPOSITIONS as readonly unknown[]).includes(value);
}

export function validateRegisterEdVisit(candidate: unknown): Result<RegisterEdVisit, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['visitId'])) issues.push("'visitId' must be a non-empty string");
  if (!isNonEmptyString(c['encounterId'])) issues.push("'encounterId' must be a non-empty string");
  if (!isNonEmptyString(c['patientId'])) issues.push("'patientId' must be a non-empty string");
  if (!isNonEmptyString(c['chiefComplaint'])) issues.push("'chiefComplaint' must be a non-empty string");
  if (!isIsoTimestamp(c['registeredAt'])) issues.push("'registeredAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'RegisterEdVisit',
    visitId: emergencyVisitId(c['visitId'] as string),
    encounterId: encounterId(c['encounterId'] as string),
    patientId: patientId(c['patientId'] as string),
    chiefComplaint: c['chiefComplaint'] as string,
    registeredAt: isoTimestamp(c['registeredAt'] as string),
  });
}

export function validateTriagePatient(candidate: unknown): Result<TriagePatient, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['visitId'])) issues.push("'visitId' must be a non-empty string");
  if (!isEsiLevel(c['esiLevel'])) issues.push("'esiLevel' must be one of 1, 2, 3, 4, 5");
  if (!isIsoTimestamp(c['triagedAt'])) issues.push("'triagedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'TriagePatient',
    visitId: emergencyVisitId(c['visitId'] as string),
    esiLevel: c['esiLevel'] as EsiLevel,
    triagedAt: isoTimestamp(c['triagedAt'] as string),
  });
}

export function validateDispositionPatient(candidate: unknown): Result<DispositionPatient, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['visitId'])) issues.push("'visitId' must be a non-empty string");
  if (!isDisposition(c['disposition'])) {
    issues.push("'disposition' must be one of 'admitted', 'discharged', 'transferred', 'left-without-being-seen'");
  }
  if (!isIsoTimestamp(c['dispositionedAt'])) issues.push("'dispositionedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'DispositionPatient',
    visitId: emergencyVisitId(c['visitId'] as string),
    disposition: c['disposition'] as DispositionPatient['disposition'],
    dispositionedAt: isoTimestamp(c['dispositionedAt'] as string),
  });
}

/**
 * Assembled as a single object literal checked with `satisfies` — see
 * __typetests__/emergency.exhaustiveness.ts for the compile-time proof
 * that this is total over `EmergencyInstruction`.
 */
export const emergencyInstructionValidators = {
  RegisterEdVisit: validateRegisterEdVisit,
  TriagePatient: validateTriagePatient,
  DispositionPatient: validateDispositionPatient,
} satisfies InstructionValidatorRegistry<EmergencyInstruction>;
