import type { HandlerRegistry } from '../../../../core/execution/handler.js';
import type { SchedulingContext, SchedulingEffect, SchedulingError, SchedulingInstruction } from '../../types.js';
import { scheduleBookingHandler } from '../scheduleBooking.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). The
 * compile-time proof that `schedulingHandlerRegistry` is total over
 * `SchedulingInstruction`: omitting a handler here must fail to compile.
 */
const incomplete = {
  ScheduleBooking: scheduleBookingHandler,
  // @ts-expect-error - CancelBooking intentionally omitted to prove the registry is total
} satisfies HandlerRegistry<SchedulingContext, SchedulingInstruction, SchedulingEffect, SchedulingError>;

void incomplete;
