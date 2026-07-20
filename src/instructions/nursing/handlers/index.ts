import type { HandlerRegistry } from '../../../core/execution/handler.js';
import type { NursingContext, NursingEffect, NursingError, NursingInstruction } from '../types.js';
import { grantRoleHandler } from './grantRole.js';
import { issueCredentialHandler } from './issueCredential.js';
import { revokeCredentialHandler } from './revokeCredential.js';

export const nursingHandlerRegistry = {
  IssueCredential: issueCredentialHandler,
  RevokeCredential: revokeCredentialHandler,
  GrantRole: grantRoleHandler,
} satisfies HandlerRegistry<NursingContext, NursingInstruction, NursingEffect, NursingError>;
