import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { NursingContext, NursingEffect, NursingError, NursingInstruction } from '../types.js';

type RevokeCredential = Extract<NursingInstruction, { kind: 'RevokeCredential' }>;

export const revokeCredentialHandler: Handler<NursingContext, RevokeCredential, NursingEffect, NursingError> = (
  ctx,
  instruction,
) => {
  const existing = ctx.credentials[instruction.credentialId];

  if (!existing) {
    return err({ kind: 'CredentialNotFound', credentialId: instruction.credentialId });
  }

  if (existing.status === 'revoked') {
    return err({ kind: 'CredentialAlreadyRevoked', credentialId: instruction.credentialId });
  }

  const context: NursingContext = {
    ...ctx,
    credentials: {
      ...ctx.credentials,
      [instruction.credentialId]: { ...existing, status: 'revoked', revokedAt: instruction.revokedAt },
    },
  };

  return ok({
    context,
    effects: [
      { kind: 'CredentialRevoked', credentialId: instruction.credentialId, staffId: existing.staffId, revokedAt: instruction.revokedAt },
    ],
  });
};
