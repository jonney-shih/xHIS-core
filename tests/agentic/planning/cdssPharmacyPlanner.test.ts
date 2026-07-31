import { describe, expect, it } from 'vitest';
import { createCdssPharmacyPlanner } from '../../../src/agentic/planning/cdssPharmacyPlanner.js';
import type { PharmacyDispenseReadySignal } from '../../../src/agentic/planning/cdssPharmacyPlanner.js';
import { encounterId, isoTimestamp, prescriptionId } from '../../../src/instructions/pharmacy/ids.js';
import type { PharmacyContext } from '../../../src/instructions/pharmacy/types.js';

const emptyPharmacyContext: PharmacyContext = { prescriptions: {} };

describe('createCdssPharmacyPlanner', () => {
  it('recommends dispensing for a signal whose prescription is still prescribed', async () => {
    const planner = createCdssPharmacyPlanner();
    const context: PharmacyContext = {
      prescriptions: {
        'rx-1': { prescriptionId: prescriptionId('rx-1'), encounterId: encounterId('encounter-1'), medicationCode: 'AMOX-500', status: 'prescribed', prescribedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
      },
    };
    const signal: PharmacyDispenseReadySignal = { prescriptionId: prescriptionId('rx-1') };

    const result = await planner.plan(
      { description: 'pharmacy queue sweep' },
      { pharmacyContext: context, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      [],
    );

    expect(result).toEqual({
      ok: true,
      value: {
        instructions: [{ kind: 'DispenseMedication', prescriptionId: 'rx-1', dispensedAt: '2026-08-01T01:00:00.000Z' }],
        rationale: 'CDSS pharmacy rule: recommending dispensing for 1 signal(s) whose prescription is still pending',
        modelVersion: 'cdss-pharmacy-dispense-rule-engine-v1',
        promptVersion: 'pharmacy-dispense-ruleset-v1',
      },
    });
  });

  it('is idempotent: a signal for a prescription already dispensed produces no recommendation', async () => {
    const planner = createCdssPharmacyPlanner();
    const context: PharmacyContext = {
      prescriptions: {
        'rx-1': {
          prescriptionId: prescriptionId('rx-1'),
          encounterId: encounterId('encounter-1'),
          medicationCode: 'AMOX-500',
          status: 'dispensed',
          prescribedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
          dispensedAt: isoTimestamp('2026-08-01T00:30:00.000Z'),
        },
      },
    };
    const signal: PharmacyDispenseReadySignal = { prescriptionId: prescriptionId('rx-1') };

    const result = await planner.plan({ description: 'pharmacy queue sweep' }, { pharmacyContext: context, signals: [signal] }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  it('skips a signal naming a prescriptionId that does not exist at all', async () => {
    const planner = createCdssPharmacyPlanner();
    const signal: PharmacyDispenseReadySignal = { prescriptionId: prescriptionId('rx-unknown') };

    const result = await planner.plan({ description: 'pharmacy queue sweep' }, { pharmacyContext: emptyPharmacyContext, signals: [signal] }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  /**
   * The pharmacy-specific counterpart to `createCdssBedPlanner`'s own
   * "never recommends the same bed to two different signals" test —
   * arrived at for a different reason (see `cdssPharmacyPlanner.ts`'s
   * own doc comment): not resource contention, but that two
   * `DispenseMedication` instructions for the same `prescriptionId`
   * would doom the whole batch at Do time.
   */
  it('recommends dispensing at most once even if the same prescriptionId is signaled twice in one batch', async () => {
    const planner = createCdssPharmacyPlanner();
    const context: PharmacyContext = {
      prescriptions: {
        'rx-1': { prescriptionId: prescriptionId('rx-1'), encounterId: encounterId('encounter-1'), medicationCode: 'AMOX-500', status: 'prescribed', prescribedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
      },
    };
    const signals: readonly PharmacyDispenseReadySignal[] = [{ prescriptionId: prescriptionId('rx-1') }, { prescriptionId: prescriptionId('rx-1') }];

    const result = await planner.plan({ description: 'pharmacy queue sweep' }, { pharmacyContext: context, signals }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([
      { kind: 'DispenseMedication', prescriptionId: 'rx-1', dispensedAt: '2026-08-01T01:00:00.000Z' },
    ]);
  });

  it('handles multiple independent signals for distinct prescriptions without any cross-signal interaction', async () => {
    const planner = createCdssPharmacyPlanner();
    const context: PharmacyContext = {
      prescriptions: {
        'rx-1': { prescriptionId: prescriptionId('rx-1'), encounterId: encounterId('encounter-1'), medicationCode: 'AMOX-500', status: 'prescribed', prescribedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
        'rx-2': { prescriptionId: prescriptionId('rx-2'), encounterId: encounterId('encounter-2'), medicationCode: 'IBU-200', status: 'prescribed', prescribedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
      },
    };
    const signals: readonly PharmacyDispenseReadySignal[] = [{ prescriptionId: prescriptionId('rx-1') }, { prescriptionId: prescriptionId('rx-2') }];

    const result = await planner.plan({ description: 'pharmacy queue sweep' }, { pharmacyContext: context, signals }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([
      { kind: 'DispenseMedication', prescriptionId: 'rx-1', dispensedAt: '2026-08-01T01:00:00.000Z' },
      { kind: 'DispenseMedication', prescriptionId: 'rx-2', dispensedAt: '2026-08-01T01:00:00.000Z' },
    ]);
  });

  it('ignores feedback — the rule is a pure function of context and signals, not of prior attempts', async () => {
    const planner = createCdssPharmacyPlanner();
    const context: PharmacyContext = {
      prescriptions: { 'rx-1': { prescriptionId: prescriptionId('rx-1'), encounterId: encounterId('encounter-1'), medicationCode: 'AMOX-500', status: 'prescribed', prescribedAt: isoTimestamp('2026-08-01T00:00:00.000Z') } },
    };
    const signal: PharmacyDispenseReadySignal = { prescriptionId: prescriptionId('rx-1') };

    const first = await planner.plan({ description: 'pharmacy queue sweep' }, { pharmacyContext: context, signals: [signal] }, '2026-08-01T01:00:00.000Z', []);
    const second = await planner.plan(
      { description: 'pharmacy queue sweep' },
      { pharmacyContext: context, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      ['some prior feedback that a deterministic rule has no way to act on'],
    );

    expect(first).toEqual(second);
  });
});
