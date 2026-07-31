import { validatePrescribeMedication } from '../pharmacy.js';
import type { PharmacyInstruction } from '../../../instructions/pharmacy/types.js';
import type { InstructionValidatorRegistry } from '../validator.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `pharmacyInstructionValidators` is total
 * over `PharmacyInstruction`: omitting a validator here must fail to
 * compile.
 */
const incomplete = {
  PrescribeMedication: validatePrescribeMedication,
  // @ts-expect-error - DispenseMedication intentionally omitted to prove the registry is total
} satisfies InstructionValidatorRegistry<PharmacyInstruction>;

void incomplete;
