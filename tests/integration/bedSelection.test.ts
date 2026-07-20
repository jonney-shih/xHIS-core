import { describe, expect, it } from 'vitest';
import { EXAMPLE_firstAvailableBedStrategy } from '../../src/integration/bedSelection.js';
import { bedId, encounterId, isoTimestamp } from '../../src/instructions/bed/ids.js';
import type { BedContext } from '../../src/instructions/bed/types.js';

describe('EXAMPLE_firstAvailableBedStrategy', () => {
  it('selects the lexicographically-first available bed', () => {
    const context: BedContext = {
      beds: {
        'bed-2': { bedId: bedId('bed-2'), status: 'available' },
        'bed-1': { bedId: bedId('bed-1'), status: 'available' },
      },
    };

    expect(EXAMPLE_firstAvailableBedStrategy.selectAvailableBed(context)).toBe('bed-1');
  });

  it('skips occupied beds', () => {
    const context: BedContext = {
      beds: {
        'bed-1': {
          bedId: bedId('bed-1'),
          status: 'occupied',
          encounterId: encounterId('encounter-1'),
          assignedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
        },
        'bed-2': { bedId: bedId('bed-2'), status: 'available' },
      },
    };

    expect(EXAMPLE_firstAvailableBedStrategy.selectAvailableBed(context)).toBe('bed-2');
  });

  it('returns undefined when no bed is available', () => {
    const context: BedContext = {
      beds: {
        'bed-1': {
          bedId: bedId('bed-1'),
          status: 'occupied',
          encounterId: encounterId('encounter-1'),
          assignedAt: isoTimestamp('2026-07-18T00:00:00.000Z'),
        },
      },
    };

    expect(EXAMPLE_firstAvailableBedStrategy.selectAvailableBed(context)).toBeUndefined();
  });

  it('returns undefined when there are no beds at all', () => {
    expect(EXAMPLE_firstAvailableBedStrategy.selectAvailableBed({ beds: {} })).toBeUndefined();
  });
});
