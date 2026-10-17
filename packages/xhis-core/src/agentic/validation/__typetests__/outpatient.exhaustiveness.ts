import {
  validateCheckInPatient,
  validateFinalizeSoapNote,
  validatePlaceCpoeOrder,
  validateRecordSoapNote,
} from '../outpatient.js';
import type { OutpatientInstruction } from '../../../instructions/outpatient/types.js';
import type { InstructionValidatorRegistry } from '../validator.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `outpatientInstructionValidators` is total
 * over `OutpatientInstruction`: omitting a validator here must fail to
 * compile.
 */
const incomplete = {
  CheckInPatient: validateCheckInPatient,
  RecordSoapNote: validateRecordSoapNote,
  FinalizeSoapNote: validateFinalizeSoapNote,
  PlaceCpoeOrder: validatePlaceCpoeOrder,
  // @ts-expect-error - CompleteEncounter intentionally omitted to prove the registry is total
} satisfies InstructionValidatorRegistry<OutpatientInstruction>;

void incomplete;
