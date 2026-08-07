import type { HandlerRegistry } from '../../../../core/execution/handler.js';
import type { NursingContext, NursingEffect, NursingError, NursingInstruction } from '../../types.js';
import { issueCredentialHandler } from '../issueCredential.js';
import { revokeCredentialHandler } from '../revokeCredential.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). The
 * compile-time proof that `nursingHandlerRegistry` is total over
 * `NursingInstruction`: omitting a handler here must fail to compile.
 */
const incomplete = {
  IssueCredential: issueCredentialHandler,
  RevokeCredential: revokeCredentialHandler,
  // @ts-expect-error - GrantRole intentionally omitted to prove the registry is total
} satisfies HandlerRegistry<NursingContext, NursingInstruction, NursingEffect, NursingError>;

void incomplete;
