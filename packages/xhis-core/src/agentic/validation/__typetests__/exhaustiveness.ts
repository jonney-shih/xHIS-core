import type { PatientInstruction } from '../../../instructions/patient/types.js';
import { validateAdmitPatient } from '../patient.js';
import type { InstructionValidatorRegistry } from '../validator.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `patientInstructionValidators` is total over
 * `PatientInstruction`: omitting a validator here must fail to compile. If
 * someone adds a new `PatientInstruction` variant without updating this
 * file to still omit it correctly, `tsc` will complain that the
 * `@ts-expect-error` is unused, which is exactly the signal that the
 * registry is no longer exhaustive.
 */
const incomplete = {
  AdmitPatient: validateAdmitPatient,
  // @ts-expect-error - DischargePatient intentionally omitted to prove the registry is total
} satisfies InstructionValidatorRegistry<PatientInstruction>;

void incomplete;
