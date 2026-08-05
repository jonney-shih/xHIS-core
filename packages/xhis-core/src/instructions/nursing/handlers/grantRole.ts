import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { NursingContext, NursingEffect, NursingError, NursingInstruction } from '../types.js';

type GrantRole = Extract<NursingInstruction, { kind: 'GrantRole' }>;

/**
 * The domain-specific invariant proof: a role grant is only valid if
 * backed by a credential that (a) belongs to the same staff member —
 * not borrowed from someone else's, (b) has not been revoked, and (c)
 * has not yet expired as of `grantedAt`. All three are checked here,
 * before the grant is ever recorded — rejecting outright, same "no
 * silent failure" discipline as every other domain-specific invariant
 * proof in this codebase (`ledger`'s balance check, `scheduling`'s
 * overlap check).
 *
 * Expiry uses plain string comparison against `IsoTimestamp`, not a
 * parsed date object — the same reason `scheduling/handlers/overlap.ts`
 * does: the determinism guard bans constructing one under
 * `src/instructions`, and every timestamp here is already a fixed-
 * width, UTC ISO-8601 string, so lexicographic comparison already
 * matches chronological comparison. Half-open, matching `scheduling`'s
 * convention: valid on `[issuedAt, expiresAt)` — a grant made at the
 * exact instant a credential expires is not valid.
 */
export const grantRoleHandler: Handler<NursingContext, GrantRole, NursingEffect, NursingError> = (ctx, instruction) => {
  if (ctx.roleGrants[instruction.grantId]) {
    return err({ kind: 'GrantAlreadyExists', grantId: instruction.grantId });
  }

  const credential = ctx.credentials[instruction.credentialId];

  if (!credential) {
    return err({ kind: 'CredentialNotFound', credentialId: instruction.credentialId });
  }

  if (credential.staffId !== instruction.staffId) {
    return err({ kind: 'CredentialStaffMismatch', grantId: instruction.grantId, credentialId: instruction.credentialId });
  }

  if (credential.status === 'revoked') {
    return err({ kind: 'CredentialRevoked', grantId: instruction.grantId, credentialId: instruction.credentialId });
  }

  if (!(instruction.grantedAt < credential.expiresAt)) {
    return err({
      kind: 'CredentialExpired',
      grantId: instruction.grantId,
      credentialId: instruction.credentialId,
      expiresAt: credential.expiresAt,
      grantedAt: instruction.grantedAt,
    });
  }

  const context: NursingContext = {
    ...ctx,
    roleGrants: {
      ...ctx.roleGrants,
      [instruction.grantId]: {
        grantId: instruction.grantId,
        staffId: instruction.staffId,
        role: instruction.role,
        credentialId: instruction.credentialId,
        grantedAt: instruction.grantedAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'RoleGranted',
        grantId: instruction.grantId,
        staffId: instruction.staffId,
        role: instruction.role,
        credentialId: instruction.credentialId,
        grantedAt: instruction.grantedAt,
      },
    ],
  });
};
