import { validateAssignBed } from '../bed.js';
import type { BedInstruction } from '../../../instructions/bed/types.js';
import type { InstructionValidatorRegistry } from '../validator.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `bedInstructionValidators` is total over
 * `BedInstruction`: omitting a validator here must fail to compile.
 */
const incomplete = {
  AssignBed: validateAssignBed,
  // @ts-expect-error - ReleaseBed intentionally omitted to prove the registry is total
} satisfies InstructionValidatorRegistry<BedInstruction>;

void incomplete;
