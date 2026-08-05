import { describe, expect, it } from 'vitest';
import { createCdssLabPlanner } from '../../../src/agentic/planning/cdssLabPlanner.js';
import type { LabDischargeSignal } from '../../../src/agentic/planning/cdssLabPlanner.js';
import { encounterId, isoTimestamp, labOrderId } from '../../../src/instructions/lab/ids.js';
import { patientId } from '../../../src/instructions/patient/ids.js';
import type { LabContext } from '../../../src/instructions/lab/types.js';

const emptyLabContext: LabContext = { orders: {} };

describe('createCdssLabPlanner', () => {
  it('recommends cancellation of a single pending order for a discharge signal', async () => {
    const planner = createCdssLabPlanner();
    const context: LabContext = {
      orders: {
        'order-1': { orderId: labOrderId('order-1'), encounterId: encounterId('encounter-1'), testCode: 'CBC', status: 'ordered', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
      },
    };
    const signal: LabDischargeSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };

    const result = await planner.plan(
      { description: 'discharge sweep' },
      { labContext: context, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      [],
    );

    expect(result).toEqual({
      ok: true,
      value: {
        instructions: [{ kind: 'CancelLabOrder', orderId: 'order-1', cancelledAt: '2026-08-01T01:00:00.000Z' }],
        rationale: 'CDSS lab rule: recommending cancellation of 1 pending order(s) across 1 discharge signal(s)',
        modelVersion: 'cdss-lab-cancellation-rule-engine-v1',
        promptVersion: 'lab-cancellation-ruleset-v1',
      },
    });
  });

  it('is naturally idempotent: a discharge signal for an encounter with nothing pending produces no recommendation', async () => {
    const planner = createCdssLabPlanner();
    const context: LabContext = {
      orders: {
        'order-1': {
          orderId: labOrderId('order-1'),
          encounterId: encounterId('encounter-1'),
          testCode: 'CBC',
          status: 'cancelled',
          orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z'),
          cancelledAt: isoTimestamp('2026-08-01T00:30:00.000Z'),
        },
      },
    };
    const signal: LabDischargeSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };

    const result = await planner.plan({ description: 'discharge sweep' }, { labContext: context, signals: [signal] }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  it('produces no recommendation for a signal whose encounter has never had any order at all', async () => {
    const planner = createCdssLabPlanner();
    const signal: LabDischargeSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };

    const result = await planner.plan({ description: 'discharge sweep' }, { labContext: emptyLabContext, signals: [signal] }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([]);
  });

  /**
   * The many-to-one proof triage's and bed's planners never needed: one
   * signal, multiple pending orders for the same encounter, must produce
   * one `CancelLabOrder` per order — not one recommendation total, and
   * not an arbitrary pick among them.
   */
  it('recommends cancellation of every pending order for a single discharge signal, not just one', async () => {
    const planner = createCdssLabPlanner();
    const context: LabContext = {
      orders: {
        'order-2': { orderId: labOrderId('order-2'), encounterId: encounterId('encounter-1'), testCode: 'CMP', status: 'ordered', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
        'order-1': { orderId: labOrderId('order-1'), encounterId: encounterId('encounter-1'), testCode: 'CBC', status: 'ordered', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
      },
    };
    const signal: LabDischargeSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };

    const result = await planner.plan({ description: 'discharge sweep' }, { labContext: context, signals: [signal] }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // Sorted for determinism, the same guarantee findPendingLabOrdersForEncounter's own doc comment gives.
    expect(result.value.instructions).toEqual([
      { kind: 'CancelLabOrder', orderId: 'order-1', cancelledAt: '2026-08-01T01:00:00.000Z' },
      { kind: 'CancelLabOrder', orderId: 'order-2', cancelledAt: '2026-08-01T01:00:00.000Z' },
    ]);
  });

  /**
   * The contrast with `createCdssBedPlanner`'s own "never recommends the
   * same bed to two different signals" test: lab's cancellations for two
   * different encounters never contend with each other at all, since
   * there is no shared, exhaustible resource to allocate — each signal's
   * recommendation is fully independent of every other signal's.
   */
  it('handles multiple independent discharge signals without any cross-signal interaction', async () => {
    const planner = createCdssLabPlanner();
    const context: LabContext = {
      orders: {
        'order-1': { orderId: labOrderId('order-1'), encounterId: encounterId('encounter-1'), testCode: 'CBC', status: 'ordered', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
        'order-2': { orderId: labOrderId('order-2'), encounterId: encounterId('encounter-2'), testCode: 'CMP', status: 'ordered', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') },
      },
    };
    const signals: readonly LabDischargeSignal[] = [{ encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') }, { encounterId: encounterId('encounter-2'), patientId: patientId('patient-2') }];

    const result = await planner.plan({ description: 'discharge sweep' }, { labContext: context, signals }, '2026-08-01T01:00:00.000Z', []);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.instructions).toEqual([
      { kind: 'CancelLabOrder', orderId: 'order-1', cancelledAt: '2026-08-01T01:00:00.000Z' },
      { kind: 'CancelLabOrder', orderId: 'order-2', cancelledAt: '2026-08-01T01:00:00.000Z' },
    ]);
  });

  it('ignores feedback — the rule is a pure function of context and signals, not of prior attempts', async () => {
    const planner = createCdssLabPlanner();
    const context: LabContext = {
      orders: { 'order-1': { orderId: labOrderId('order-1'), encounterId: encounterId('encounter-1'), testCode: 'CBC', status: 'ordered', orderedAt: isoTimestamp('2026-08-01T00:00:00.000Z') } },
    };
    const signal: LabDischargeSignal = { encounterId: encounterId('encounter-1'), patientId: patientId('patient-1') };

    const first = await planner.plan({ description: 'discharge sweep' }, { labContext: context, signals: [signal] }, '2026-08-01T01:00:00.000Z', []);
    const second = await planner.plan(
      { description: 'discharge sweep' },
      { labContext: context, signals: [signal] },
      '2026-08-01T01:00:00.000Z',
      ['some prior feedback that a deterministic rule has no way to act on'],
    );

    expect(first).toEqual(second);
  });
});
