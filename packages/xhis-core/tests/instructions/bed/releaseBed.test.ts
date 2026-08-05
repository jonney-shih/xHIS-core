import { describe, expect, it } from 'vitest';
import { releaseBedHandler } from '../../../src/instructions/bed/handlers/releaseBed.js';
import { bedId, encounterId, isoTimestamp } from '../../../src/instructions/bed/ids.js';
import type { BedContext } from '../../../src/instructions/bed/types.js';

const contextWithOccupiedBed: BedContext = {
  beds: {
    'bed-1': {
      bedId: bedId('bed-1'),
      status: 'occupied',
      encounterId: encounterId('encounter-1'),
      assignedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
    },
  },
};

describe('releaseBedHandler', () => {
  it('frees an occupied bed and emits a BedReleased effect citing the bed\'s own recorded encounter', () => {
    const result = releaseBedHandler(contextWithOccupiedBed, {
      kind: 'ReleaseBed',
      bedId: bedId('bed-1'),
      releasedAt: isoTimestamp('2026-07-19T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');

    expect(result.value.context.beds['bed-1']).toEqual({ bedId: 'bed-1', status: 'available' });
    expect(result.value.effects).toEqual([
      { kind: 'BedReleased', bedId: 'bed-1', encounterId: 'encounter-1', releasedAt: '2026-07-19T00:00:00.000Z' },
    ]);
  });

  it('never mutates the input context', () => {
    const before = JSON.stringify(contextWithOccupiedBed);

    releaseBedHandler(contextWithOccupiedBed, {
      kind: 'ReleaseBed',
      bedId: bedId('bed-1'),
      releasedAt: isoTimestamp('2026-07-19T00:00:00.000Z'),
    });

    expect(JSON.stringify(contextWithOccupiedBed)).toBe(before);
  });

  it('rejects releasing a bed that is not tracked at all', () => {
    const result = releaseBedHandler(
      { beds: {} },
      { kind: 'ReleaseBed', bedId: bedId('bed-1'), releasedAt: isoTimestamp('2026-07-19T00:00:00.000Z') },
    );

    expect(result).toEqual({ ok: false, error: { kind: 'BedNotFound', bedId: 'bed-1' } });
  });

  it('rejects releasing a bed that is not currently occupied', () => {
    const availableContext: BedContext = { beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' } } };

    const result = releaseBedHandler(availableContext, {
      kind: 'ReleaseBed',
      bedId: bedId('bed-1'),
      releasedAt: isoTimestamp('2026-07-19T00:00:00.000Z'),
    });

    expect(result).toEqual({ ok: false, error: { kind: 'BedNotOccupied', bedId: 'bed-1' } });
  });
});
