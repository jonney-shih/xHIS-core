import { validateScheduleBooking } from '../scheduling.js';
import type { SchedulingInstruction } from '../../../instructions/scheduling/types.js';
import type { InstructionValidatorRegistry } from '../validator.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `schedulingInstructionValidators` is total
 * over `SchedulingInstruction`: omitting a validator here must fail to
 * compile.
 */
const incomplete = {
  ScheduleBooking: validateScheduleBooking,
  // @ts-expect-error - CancelBooking intentionally omitted to prove the registry is total
} satisfies InstructionValidatorRegistry<SchedulingInstruction>;

void incomplete;
