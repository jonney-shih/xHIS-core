import { validateGrantRole, validateIssueCredential } from '../nursing.js';
import type { NursingInstruction } from '../../../instructions/nursing/types.js';
import type { InstructionValidatorRegistry } from '../validator.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `nursingInstructionValidators` is total
 * over `NursingInstruction`: omitting a validator here must fail to
 * compile.
 */
const incomplete = {
  IssueCredential: validateIssueCredential,
  GrantRole: validateGrantRole,
  // @ts-expect-error - RevokeCredential intentionally omitted to prove the registry is total
} satisfies InstructionValidatorRegistry<NursingInstruction>;

void incomplete;
