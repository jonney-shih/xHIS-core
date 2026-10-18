import { validateRegisterEdVisit, validateTriagePatient } from '../emergency.js';
import type { EmergencyInstruction } from '../../../instructions/emergency/types.js';
import type { InstructionValidatorRegistry } from '../validator.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `emergencyInstructionValidators` is total
 * over `EmergencyInstruction`: omitting a validator here must fail to
 * compile.
 */
const incomplete = {
  RegisterEdVisit: validateRegisterEdVisit,
  TriagePatient: validateTriagePatient,
  // @ts-expect-error - DispositionPatient intentionally omitted to prove the registry is total
} satisfies InstructionValidatorRegistry<EmergencyInstruction>;

void incomplete;
