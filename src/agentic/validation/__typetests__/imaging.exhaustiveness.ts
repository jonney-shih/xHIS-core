import { validateOrderStudy, validateRecordStudyStored, validateReportStudy } from '../imaging.js';
import type { ImagingInstruction } from '../../../instructions/imaging/types.js';
import type { InstructionValidatorRegistry } from '../validator.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `imagingInstructionValidators` is total
 * over `ImagingInstruction`: omitting a validator here must fail to
 * compile.
 */
const incomplete = {
  OrderStudy: validateOrderStudy,
  RecordStudyStored: validateRecordStudyStored,
  ReportStudy: validateReportStudy,
  // @ts-expect-error - CancelStudy intentionally omitted to prove the registry is total
} satisfies InstructionValidatorRegistry<ImagingInstruction>;

void incomplete;
