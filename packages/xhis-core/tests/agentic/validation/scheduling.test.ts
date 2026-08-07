import { describe, expect, it } from 'vitest';
import { schedulingInstructionValidators } from '../../../src/agentic/validation/scheduling.js';
import { validateInstruction } from '../../../src/agentic/validation/validator.js';

describe('schedulingInstructionValidators', () => {
  it('accepts a well-formed ScheduleBooking candidate and brands its fields', () => {
    const result = validateInstruction(schedulingInstructionValidators, {
      kind: 'ScheduleBooking',
      bookingId: 'booking-1',
      resourceId: 'or-1',
      subjectId: 'patient-1',
      startAt: '2026-07-22T09:00:00.000Z',
      endAt: '2026-07-22T10:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'ScheduleBooking',
        bookingId: 'booking-1',
        resourceId: 'or-1',
        subjectId: 'patient-1',
        startAt: '2026-07-22T09:00:00.000Z',
        endAt: '2026-07-22T10:00:00.000Z',
      },
    });
  });

  it('accepts a well-formed CancelBooking candidate', () => {
    const result = validateInstruction(schedulingInstructionValidators, {
      kind: 'CancelBooking',
      bookingId: 'booking-1',
      cancelledAt: '2026-07-22T02:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: 'CancelBooking', bookingId: 'booking-1', cancelledAt: '2026-07-22T02:00:00.000Z' },
    });
  });

  it('rejects a candidate missing required fields, reporting every issue', () => {
    const result = validateInstruction(schedulingInstructionValidators, {
      kind: 'ScheduleBooking',
      bookingId: '',
    });

    expect(result).toEqual({
      ok: false,
      error: [
        "'bookingId' must be a non-empty string",
        "'resourceId' must be a non-empty string",
        "'subjectId' must be a non-empty string",
        "'startAt' must be an ISO-8601 timestamp string",
        "'endAt' must be an ISO-8601 timestamp string",
      ],
    });
  });

  it('rejects a timestamp that is not ISO-8601 shaped', () => {
    const result = validateInstruction(schedulingInstructionValidators, {
      kind: 'CancelBooking',
      bookingId: 'booking-1',
      cancelledAt: 'yesterday',
    });

    expect(result).toEqual({ ok: false, error: ["'cancelledAt' must be an ISO-8601 timestamp string"] });
  });

  it('rejects an unknown instruction kind', () => {
    const result = validateInstruction(schedulingInstructionValidators, { kind: 'RescheduleBooking', bookingId: 'booking-1' });

    expect(result).toEqual({ ok: false, error: ["unknown instruction kind 'RescheduleBooking'"] });
  });
});
