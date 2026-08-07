import { describe, expect, it } from 'vitest';
import { schedulingEngine } from '../../src/instructions/scheduling/engine.js';
import { bookingId, resourceId, isoTimestamp as schedulingIsoTimestamp } from '../../src/instructions/scheduling/ids.js';
import type { SchedulingContext, SchedulingError } from '../../src/instructions/scheduling/types.js';
import { patientEngine } from '../../src/instructions/patient/engine.js';
import { encounterId, isoTimestamp, patientId } from '../../src/instructions/patient/ids.js';
import type { PatientContext, PatientEffect } from '../../src/instructions/patient/types.js';
import { reactToPatientEffect, reactToPatientEffectsForScheduling } from '../../src/integration/patientToScheduling.js';
import type { SchedulingEngineLike } from '../../src/integration/patientToScheduling.js';

const twoPendingBookingsForEncounter1: SchedulingContext = {
  bookings: {
    'booking-1': {
      bookingId: bookingId('booking-1'),
      resourceId: resourceId('or-1'),
      subjectId: 'encounter-1',
      startAt: schedulingIsoTimestamp('2026-07-21T09:00:00.000Z'),
      endAt: schedulingIsoTimestamp('2026-07-21T10:00:00.000Z'),
      status: 'scheduled',
    },
    'booking-2': {
      bookingId: bookingId('booking-2'),
      resourceId: resourceId('ct-1'),
      subjectId: 'encounter-1',
      startAt: schedulingIsoTimestamp('2026-07-21T11:00:00.000Z'),
      endAt: schedulingIsoTimestamp('2026-07-21T11:30:00.000Z'),
      status: 'scheduled',
    },
  },
};

const admitted: PatientEffect = {
  kind: 'EncounterAdmitted',
  encounterId: encounterId('encounter-1'),
  patientId: patientId('patient-1'),
  admittedAt: isoTimestamp('2026-07-21T00:00:00.000Z'),
};

const discharged: PatientEffect = {
  kind: 'EncounterDischarged',
  encounterId: encounterId('encounter-1'),
  dischargedAt: isoTimestamp('2026-07-22T00:00:00.000Z'),
};

describe('reactToPatientEffect', () => {
  it('reports no-pending-bookings for EncounterAdmitted — admission never implies a booking', () => {
    const reaction = reactToPatientEffect(admitted, twoPendingBookingsForEncounter1, schedulingIsoTimestamp('2026-07-22T00:00:00.000Z'));

    expect(reaction).toEqual({ kind: 'no-pending-bookings', encounterId: 'encounter-1' });
  });

  it('produces one CancelBooking instruction per still-scheduled booking for EncounterDischarged', () => {
    const reaction = reactToPatientEffect(discharged, twoPendingBookingsForEncounter1, schedulingIsoTimestamp('2026-07-22T00:00:00.000Z'));

    expect(reaction).toEqual({
      kind: 'cancel-pending',
      instructions: [
        { kind: 'CancelBooking', bookingId: 'booking-1', cancelledAt: '2026-07-22T00:00:00.000Z' },
        { kind: 'CancelBooking', bookingId: 'booking-2', cancelledAt: '2026-07-22T00:00:00.000Z' },
      ],
    });
  });

  it('reports no-pending-bookings for EncounterDischarged when nothing is pending', () => {
    const reaction = reactToPatientEffect(discharged, { bookings: {} }, schedulingIsoTimestamp('2026-07-22T00:00:00.000Z'));

    expect(reaction).toEqual({ kind: 'no-pending-bookings', encounterId: 'encounter-1' });
  });

  it('ignores bookings already cancelled, and bookings belonging to a different encounter', () => {
    const mixedContext: SchedulingContext = {
      bookings: {
        'booking-1': {
          bookingId: bookingId('booking-1'),
          resourceId: resourceId('or-1'),
          subjectId: 'encounter-1',
          startAt: schedulingIsoTimestamp('2026-07-21T09:00:00.000Z'),
          endAt: schedulingIsoTimestamp('2026-07-21T10:00:00.000Z'),
          status: 'cancelled',
          cancelledAt: schedulingIsoTimestamp('2026-07-21T08:00:00.000Z'),
        },
        'booking-2': {
          bookingId: bookingId('booking-2'),
          resourceId: resourceId('ct-1'),
          subjectId: 'encounter-2',
          startAt: schedulingIsoTimestamp('2026-07-21T11:00:00.000Z'),
          endAt: schedulingIsoTimestamp('2026-07-21T11:30:00.000Z'),
          status: 'scheduled',
        },
      },
    };

    const reaction = reactToPatientEffect(discharged, mixedContext, schedulingIsoTimestamp('2026-07-22T00:00:00.000Z'));

    expect(reaction).toEqual({ kind: 'no-pending-bookings', encounterId: 'encounter-1' });
  });

  it('ignores a booking whose subjectId is not an encounter at all — subjectId is a plain string, not a foreign key', () => {
    const equipmentMaintenanceContext: SchedulingContext = {
      bookings: {
        'booking-maintenance': {
          bookingId: bookingId('booking-maintenance'),
          resourceId: resourceId('mri-1'),
          subjectId: 'quarterly-maintenance',
          startAt: schedulingIsoTimestamp('2026-07-21T09:00:00.000Z'),
          endAt: schedulingIsoTimestamp('2026-07-21T12:00:00.000Z'),
          status: 'scheduled',
        },
      },
    };

    const reaction = reactToPatientEffect(discharged, equipmentMaintenanceContext, schedulingIsoTimestamp('2026-07-22T00:00:00.000Z'));

    expect(reaction).toEqual({ kind: 'no-pending-bookings', encounterId: 'encounter-1' });
  });
});

describe('reactToPatientEffectsForScheduling', () => {
  it('cancels every pending booking for a discharged encounter, redelivery-safe: a second run finds nothing left to cancel', () => {
    const first = reactToPatientEffectsForScheduling(schedulingEngine, twoPendingBookingsForEncounter1, [discharged], schedulingIsoTimestamp('2026-07-22T00:00:00.000Z'));

    expect(first.outcomes).toEqual([
      { kind: 'cancelled', encounterId: 'encounter-1', bookingId: 'booking-1' },
      { kind: 'cancelled', encounterId: 'encounter-1', bookingId: 'booking-2' },
    ]);
    expect(first.context.bookings['booking-1'].status).toBe('cancelled');
    expect(first.context.bookings['booking-2'].status).toBe('cancelled');

    const redelivered = reactToPatientEffectsForScheduling(schedulingEngine, first.context, [discharged], schedulingIsoTimestamp('2026-07-22T00:01:00.000Z'));

    expect(redelivered.outcomes).toEqual([{ kind: 'no-pending-bookings', encounterId: 'encounter-1' }]);
    expect(redelivered.effects).toEqual([]);
  });

  it('reports reaction-failed for one booking without blocking cancellation of the rest', () => {
    const failingEngine: SchedulingEngineLike = {
      execute: (context, instruction) => {
        if (instruction.kind === 'CancelBooking' && instruction.bookingId === bookingId('booking-1')) {
          return { ok: false, error: { kind: 'BookingNotFound', bookingId: bookingId('booking-1') } satisfies SchedulingError };
        }
        return schedulingEngine.execute(context, instruction);
      },
    };

    const result = reactToPatientEffectsForScheduling(failingEngine, twoPendingBookingsForEncounter1, [discharged], schedulingIsoTimestamp('2026-07-22T00:00:00.000Z'));

    expect(result.outcomes).toEqual([
      { kind: 'reaction-failed', encounterId: 'encounter-1', bookingId: 'booking-1', error: { kind: 'BookingNotFound', bookingId: 'booking-1' } },
      { kind: 'cancelled', encounterId: 'encounter-1', bookingId: 'booking-2' },
    ]);
  });
});

describe('patient discharge -> scheduling booking cancellation, end to end', () => {
  it('admits a patient, schedules two bookings, discharges the patient, and cancels both still-pending bookings', () => {
    const emptyPatientContext: PatientContext = { encounters: {} };

    const admissionOutcome = patientEngine.executeSequence(emptyPatientContext, [
      { kind: 'AdmitPatient', patientId: patientId('patient-1'), encounterId: encounterId('encounter-1'), admittedAt: isoTimestamp('2026-07-21T00:00:00.000Z') },
    ]);
    expect(admissionOutcome.ok).toBe(true);
    if (!admissionOutcome.ok) throw new Error('expected ok');

    const scheduleOutcome = schedulingEngine.executeSequence(
      { bookings: {} },
      [
        { kind: 'ScheduleBooking', bookingId: bookingId('booking-1'), resourceId: resourceId('or-1'), subjectId: 'encounter-1', startAt: schedulingIsoTimestamp('2026-07-21T09:00:00.000Z'), endAt: schedulingIsoTimestamp('2026-07-21T10:00:00.000Z') },
        { kind: 'ScheduleBooking', bookingId: bookingId('booking-2'), resourceId: resourceId('ct-1'), subjectId: 'encounter-1', startAt: schedulingIsoTimestamp('2026-07-21T11:00:00.000Z'), endAt: schedulingIsoTimestamp('2026-07-21T11:30:00.000Z') },
      ],
    );
    expect(scheduleOutcome.ok).toBe(true);
    if (!scheduleOutcome.ok) throw new Error('expected ok');

    const dischargeOutcome = patientEngine.executeSequence(admissionOutcome.value.context, [
      { kind: 'DischargePatient', encounterId: encounterId('encounter-1'), dischargedAt: isoTimestamp('2026-07-22T00:00:00.000Z') },
    ]);
    expect(dischargeOutcome.ok).toBe(true);
    if (!dischargeOutcome.ok) throw new Error('expected ok');

    const afterDischarge = reactToPatientEffectsForScheduling(
      schedulingEngine,
      scheduleOutcome.value.context,
      dischargeOutcome.value.effects,
      schedulingIsoTimestamp('2026-07-22T00:01:00.000Z'),
    );

    expect(afterDischarge.outcomes).toEqual([
      { kind: 'cancelled', encounterId: 'encounter-1', bookingId: 'booking-1' },
      { kind: 'cancelled', encounterId: 'encounter-1', bookingId: 'booking-2' },
    ]);
    expect(afterDischarge.context.bookings['booking-1'].status).toBe('cancelled');
    expect(afterDischarge.context.bookings['booking-2'].status).toBe('cancelled');
  });
});
