import { validateAssignWard, validateFinalizeProgressNote, validateRecordProgressNote } from '../inpatient.js';
import type { InpatientInstruction } from '../../../instructions/inpatient/types.js';
import type { InstructionValidatorRegistry } from '../validator.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `inpatientInstructionValidators` is total
 * over `InpatientInstruction`: omitting a validator here must fail to
 * compile.
 */
const incomplete = {
  AssignWard: validateAssignWard,
  RecordProgressNote: validateRecordProgressNote,
  FinalizeProgressNote: validateFinalizeProgressNote,
  // @ts-expect-error - TransferWard intentionally omitted to prove the registry is total
} satisfies InstructionValidatorRegistry<InpatientInstruction>;

void incomplete;
