import type { HandlerRegistry } from '../../../core/execution/handler.js';
import type { SchedulingContext, SchedulingEffect, SchedulingError, SchedulingInstruction } from '../types.js';
import { cancelBookingHandler } from './cancelBooking.js';
import { scheduleBookingHandler } from './scheduleBooking.js';

export const schedulingHandlerRegistry = {
  ScheduleBooking: scheduleBookingHandler,
  CancelBooking: cancelBookingHandler,
} satisfies HandlerRegistry<SchedulingContext, SchedulingInstruction, SchedulingEffect, SchedulingError>;
