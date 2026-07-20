import type { CredentialRecord } from './types.js';

/**
 * Whether `credential` was valid at a given moment — a pure function of
 * the credential's own write-once fields (`expiresAt` never changes
 * after issuance; `revokedAt` is set at most once), so it can correctly
 * answer for *any* `asOf`, past or present, not just "right now."
 *
 * Used by `agentic/identity/nursingIdentityProvider.ts` (the real,
 * load-bearing use) and independently exercised by
 * `tests/instructions/nursing/credentialValidity.guard.test.ts` against
 * many synthetic sequences. Deliberately *not* called by
 * `grantRoleHandler`, which checks revocation via the credential's
 * *current* status — correct for processing an instruction now, in
 * sequence — rather than a value comparison against `revokedAt`,
 * correct for a retrospective query about an arbitrary past moment.
 * The two are different checks for different purposes, not one
 * duplicated as two.
 */
export function isCredentialValidAsOf(credential: CredentialRecord, asOf: string): boolean {
  const notYetRevoked = credential.revokedAt === undefined || asOf < credential.revokedAt;
  const notYetExpired = asOf < credential.expiresAt;
  return notYetRevoked && notYetExpired;
}
