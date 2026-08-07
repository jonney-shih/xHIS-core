import type { Handler } from '../../../core/execution/handler.js';
import { err, ok } from '../../../core/execution/result.js';
import type { NursingContext, NursingEffect, NursingError, NursingInstruction } from '../types.js';

type IssueCredential = Extract<NursingInstruction, { kind: 'IssueCredential' }>;

export const issueCredentialHandler: Handler<NursingContext, IssueCredential, NursingEffect, NursingError> = (
  ctx,
  instruction,
) => {
  if (ctx.credentials[instruction.credentialId]) {
    return err({ kind: 'CredentialAlreadyExists', credentialId: instruction.credentialId });
  }

  const context: NursingContext = {
    ...ctx,
    credentials: {
      ...ctx.credentials,
      [instruction.credentialId]: {
        credentialId: instruction.credentialId,
        staffId: instruction.staffId,
        credentialType: instruction.credentialType,
        status: 'active',
        issuedAt: instruction.issuedAt,
        expiresAt: instruction.expiresAt,
      },
    },
  };

  return ok({
    context,
    effects: [
      {
        kind: 'CredentialIssued',
        credentialId: instruction.credentialId,
        staffId: instruction.staffId,
        credentialType: instruction.credentialType,
        issuedAt: instruction.issuedAt,
        expiresAt: instruction.expiresAt,
      },
    ],
  });
};
