import { err, ok, type Result } from '../../core/execution/result.js';
import { credentialId, isoTimestamp, roleGrantId, staffId } from '../../instructions/nursing/ids.js';
import type { NursingInstruction } from '../../instructions/nursing/types.js';
import { isIsoTimestamp, isNonEmptyString } from './guards.js';
import type { InstructionValidatorRegistry } from './validator.js';

type IssueCredential = Extract<NursingInstruction, { kind: 'IssueCredential' }>;
type RevokeCredential = Extract<NursingInstruction, { kind: 'RevokeCredential' }>;
type GrantRole = Extract<NursingInstruction, { kind: 'GrantRole' }>;

export function validateIssueCredential(candidate: unknown): Result<IssueCredential, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['credentialId'])) issues.push("'credentialId' must be a non-empty string");
  if (!isNonEmptyString(c['staffId'])) issues.push("'staffId' must be a non-empty string");
  if (!isNonEmptyString(c['credentialType'])) issues.push("'credentialType' must be a non-empty string");
  if (!isIsoTimestamp(c['issuedAt'])) issues.push("'issuedAt' must be an ISO-8601 timestamp string");
  if (!isIsoTimestamp(c['expiresAt'])) issues.push("'expiresAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'IssueCredential',
    credentialId: credentialId(c['credentialId'] as string),
    staffId: staffId(c['staffId'] as string),
    credentialType: c['credentialType'] as string,
    issuedAt: isoTimestamp(c['issuedAt'] as string),
    expiresAt: isoTimestamp(c['expiresAt'] as string),
  });
}

function validateRevokeCredential(candidate: unknown): Result<RevokeCredential, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['credentialId'])) issues.push("'credentialId' must be a non-empty string");
  if (!isIsoTimestamp(c['revokedAt'])) issues.push("'revokedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'RevokeCredential',
    credentialId: credentialId(c['credentialId'] as string),
    revokedAt: isoTimestamp(c['revokedAt'] as string),
  });
}

export function validateGrantRole(candidate: unknown): Result<GrantRole, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['grantId'])) issues.push("'grantId' must be a non-empty string");
  if (!isNonEmptyString(c['staffId'])) issues.push("'staffId' must be a non-empty string");
  if (!isNonEmptyString(c['role'])) issues.push("'role' must be a non-empty string");
  if (!isNonEmptyString(c['credentialId'])) issues.push("'credentialId' must be a non-empty string");
  if (!isIsoTimestamp(c['grantedAt'])) issues.push("'grantedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'GrantRole',
    grantId: roleGrantId(c['grantId'] as string),
    staffId: staffId(c['staffId'] as string),
    role: c['role'] as string,
    credentialId: credentialId(c['credentialId'] as string),
    grantedAt: isoTimestamp(c['grantedAt'] as string),
  });
}

/**
 * Assembled as a single object literal checked with `satisfies` — see
 * __typetests__/nursing.exhaustiveness.ts for the compile-time proof that
 * this is total over `NursingInstruction`.
 */
export const nursingInstructionValidators = {
  IssueCredential: validateIssueCredential,
  RevokeCredential: validateRevokeCredential,
  GrantRole: validateGrantRole,
} satisfies InstructionValidatorRegistry<NursingInstruction>;
