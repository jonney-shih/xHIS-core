import { describe, expect, it } from 'vitest';
import { assignBedHandler } from '../../../src/instructions/bed/handlers/assignBed.js';
import { bedId, encounterId, isoTimestamp } from '../../../src/instructions/bed/ids.js';
import type { BedContext } from '../../../src/instructions/bed/types.js';

const contextWithAvailableBed: BedContext = {
  beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' } },
};

describe('assignBedHandler', () => {
  it('occupies an available bed and emits a BedAssigned effect', () => {
    const result = assignBedHandler(contextWithAvailableBed, {
      kind: 'AssignBed',
      bedId: bedId('bed-1'),
      encounterId: encounterId('encounter-1'),
      assignedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.beds['bed-1']).toEqual({
      bedId: 'bed-1',
      status: 'occupied',
      encounterId: 'encounter-1',
      assignedAt: '2026-07-18T00:00:00.000Z',
    });
    expect(result.value.effects).toEqual([
      { kind: 'BedAssigned', bedId: 'bed-1', encounterId: 'encounter-1', assignedAt: '2026-07-18T00:00:00.000Z' },
    ]);
  });

  it('never mutates the input context', () => {
    const before = JSON.stringify(contextWithAvailableBed);

    assignBedHandler(contextWithAvailableBed, {
      kind: 'AssignBed',
      bedId: bedId('bed-1'),
      encounterId: encounterId('encounter-1'),
      assignedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
    });

    expect(JSON.stringify(contextWithAvailableBed)).toBe(before);
  });

  it('rejects assigning a bed that is not tracked at all', () => {
    const result = assignBedHandler(
      { beds: {} },
      {
        kind: 'AssignBed',
        bedId: bedId('bed-1'),
        encounterId: encounterId('encounter-1'),
        assignedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
      },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'BedNotFound', bedId: 'bed-1' } });
  });

  it('rejects assigning a bed that is already occupied', () => {
    const occupiedContext: BedContext = {
      beds: {
        'bed-1': {
          bedId: bedId('bed-1'),
          status: 'occupied',
          encounterId: encounterId('encounter-0'),
          assignedAt: isoTimestamp('2026-07-17T00:00:00.000Z'),
        },
      },
    };

    const result = assignBedHandler(occupiedContext, {
      kind: 'AssignBed',
      bedId: bedId('bed-1'),
      encounterId: encounterId('encounter-1'),
      assignedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'BedAlreadyOccupied', bedId: 'bed-1' } });
  });
});
