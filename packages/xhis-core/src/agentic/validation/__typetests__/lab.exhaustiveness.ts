import type { LabInstruction } from '../../../instructions/lab/types.js';
import { validateOrderLabTest, validateReportLabResult } from '../lab.js';
import type { InstructionValidatorRegistry } from '../validator.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `labInstructionValidators` is total over
 * `LabInstruction`: omitting a validator here must fail to compile.
 */
const incomplete = {
  OrderLabTest: validateOrderLabTest,
  ReportLabResult: validateReportLabResult,
  // @ts-expect-error - CancelLabOrder intentionally omitted to prove the registry is total
} satisfies InstructionValidatorRegistry<LabInstruction>;

void incomplete;
