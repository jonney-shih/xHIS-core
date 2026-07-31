import { describe, expect, it } from 'vitest';
import { createCdssBedPlanner } from '../../../src/agentic/planning/cdssBedPlanner.js';
import type { BedNeedSignal } from '../../../src/agentic/planning/cdssBedPlanner.js';
import { EXAMPLE_firstAvailableBedStrategy } from '../../../src/integration/bedSelection.js';
import { bedId, encounterId, isoTimestamp } from '../../../src/instructions/bed/ids.js';
import type { BedContext } from '../../../src/instructions/bed/types.js';

const strategy = EXAMPLE_firstAvailableBedStrategy;

describe('createCdssBedPlanner', () => {
  it('recommends assignment for a signal not yet holding a bed, when one is available', async () => {
    const planner = createCdssBedPlanner();
    const context: BedContext = { beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' } } };
    const signal: BedNeedSignal = { encounterId: encounterId('encounter-1') };

    const result = await planner.plan(
      { description: 'bed board sweep' },
      { bedContext: context, signals: [signal], strategy },
      '2026-08-01T00:00:00.000Z',
      [],
    );

    expect(result).toEqual({
      ok: true,
      value: {
        instructions: [{ kind: 'AssignBed', bedId: 'bed-1', encounterId: 'encounter-1', assignedAt: '2026-08-01T00:00:00.000Z' }],
        rationale: 'CDSS bed-assignment rule: recommending assignment for 1 signal(s) needing a bed',
        modelVersion: 'cdss-bed-assignment-rule-engine-v1',
        promptVersion: 'bed-assignment-ruleset-v1',
      },
    });
  });

  it('is idempotent: a signal for an encounter that already holds a bed produces no recommendation', async () => {
    const planner = createCdssBedPlanner();
    const context: BedContext = {
      beds: {
        'bed-1': { bedId: bedId('bed-1'), status: 'occupied', encounterId: encounterId('encounter-1'), assignedAt: isoTimestamp('2026-07-31T00:00:00.000Z') },
        'bed-2': { bedId: bedId('bed-2'), status: 'available' },
      },
    };
    const signal: BedNeedSignal = { encounterId: encounterId('encounter-1') };

    const result = await planner.plan({ description: 'bed board sweep' }, { bedContext: context, signals: [signal], strategy }, '2026-08-01T00:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  it('skips a signal when no bed is available at all, rather than failing the whole batch', async () => {
    const planner = createCdssBedPlanner();
    const context: BedContext = {
      beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'occupied', encounterId: encounterId('encounter-0'), assignedAt: isoTimestamp('2026-07-31T00:00:00.000Z') } },
    };
    const signal: BedNeedSignal = { encounterId: encounterId('encounter-1') };

    const result = await planner.plan({ description: 'bed board sweep' }, { bedContext: context, signals: [signal], strategy }, '2026-08-01T00:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  it('skips a signal whose current bed-holding state is data-integrity ambiguous', async () => {
    const planner = createCdssBedPlanner();
    const context: BedContext = {
      beds: {
        'bed-1': { bedId: bedId('bed-1'), status: 'occupied', encounterId: encounterId('encounter-1'), assignedAt: isoTimestamp('2026-07-31T00:00:00.000Z') },
        'bed-2': { bedId: bedId('bed-2'), status: 'occupied', encounterId: encounterId('encounter-1'), assignedAt: isoTimestamp('2026-07-31T00:00:00.000Z') },
        'bed-3': { bedId: bedId('bed-3'), status: 'available' },
      },
    };
    const signal: BedNeedSignal = { encounterId: encounterId('encounter-1') };

    const result = await planner.plan({ description: 'bed board sweep' }, { bedContext: context, signals: [signal], strategy }, '2026-08-01T00:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  /**
   * The one genuinely new proof triage's own planner never needed: bed
   * availability is a shared, exhaustible resource across signals in the
   * same proposal, unlike triage's admission target space. With only one
   * available bed and two signals needing one, this proves the planner
   * threads its hypothetical selection forward rather than recommending
   * the same `bedId` twice.
   */
  it('never recommends the same bed to two different signals in the same proposal, even when only one bed is available', async () => {
    const planner = createCdssBedPlanner();
    const context: BedContext = { beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' } } };
    const signals: readonly BedNeedSignal[] = [{ encounterId: encounterId('encounter-1') }, { encounterId: encounterId('encounter-2') }];

    const result = await planner.plan({ description: 'bed board sweep' }, { bedContext: context, signals, strategy }, '2026-08-01T00:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([
      { kind: 'AssignBed', bedId: 'bed-1', encounterId: 'encounter-1', assignedAt: '2026-08-01T00:00:00.000Z' },
    ]);
  });

  it('recommends distinct beds for two signals when two beds are available', async () => {
    const planner = createCdssBedPlanner();
    const context: BedContext = {
      beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' }, 'bed-2': { bedId: bedId('bed-2'), status: 'available' } },
    };
    const signals: readonly BedNeedSignal[] = [{ encounterId: encounterId('encounter-1') }, { encounterId: encounterId('encounter-2') }];

    const result = await planner.plan({ description: 'bed board sweep' }, { bedContext: context, signals, strategy }, '2026-08-01T00:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([
      { kind: 'AssignBed', bedId: 'bed-1', encounterId: 'encounter-1', assignedAt: '2026-08-01T00:00:00.000Z' },
      { kind: 'AssignBed', bedId: 'bed-2', encounterId: 'encounter-2', assignedAt: '2026-08-01T00:00:00.000Z' },
    ]);
  });

  it('ignores feedback — the rule is a pure function of context and signals, not of prior attempts', async () => {
    const planner = createCdssBedPlanner();
    const context: BedContext = { beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' } } };
    const signal: BedNeedSignal = { encounterId: encounterId('encounter-1') };

    const first = await planner.plan({ description: 'bed board sweep' }, { bedContext: context, signals: [signal], strategy }, '2026-08-01T00:00:00.000Z', []);
    const second = await planner.plan(
      { description: 'bed board sweep' },
      { bedContext: context, signals: [signal], strategy },
      '2026-08-01T00:00:00.000Z',
      ['some prior feedback that a deterministic rule has no way to act on'],
    );

    expect(first).toEqual(second);
  });
});
