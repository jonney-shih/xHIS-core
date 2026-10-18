import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileShell, readCommits } from '../../src/agentic/shell/fileShell.js';
import { createFileOutboxCursor } from '../../src/core/io/outboxCursor.js';
import { labEngine } from '../../src/instructions/lab/engine.js';
import type { LabContext, LabEffect, LabInstruction } from '../../src/instructions/lab/types.js';
import { outpatientEngine } from '../../src/instructions/outpatient/engine.js';
import { cpoeOrderId, encounterId, isoTimestamp, patientId } from '../../src/instructions/outpatient/ids.js';
import type { OutpatientContext, OutpatientEffect, OutpatientInstruction } from '../../src/instructions/outpatient/types.js';
import { relayOutpatientEffectsToLab } from '../../src/integration/outboxRelayOutpatientToLab.js';

let dir: string;
let outpatientCommitsFile: string;
let labCommitsFile: string;
let labAuditFile: string;
let cursorFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-outbox-relay-outpatient-to-lab-'));
  outpatientCommitsFile = join(dir, 'outpatient-commits.jsonl');
  labCommitsFile = join(dir, 'lab-commits.jsonl');
  labAuditFile = join(dir, 'lab-audit.jsonl');
  cursorFile = join(dir, 'cursor.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function labShell() {
  return createFileShell<LabContext, LabInstruction, LabEffect>({ commitsFile: labCommitsFile, auditFile: labAuditFile });
}

/** Mimics what a real caller of `act()` does for outpatient instructions
 * -- same helper `outboxRelayLab.test.ts` uses for patient. */
function commitOutpatientInstructions(
  context: OutpatientContext,
  instructions: readonly OutpatientInstruction[],
): OutpatientContext {
  const outcome = outpatientEngine.executeSequence(context, instructions);
  if (!outcome.ok) throw new Error('expected outpatient instructions to succeed in this test');

  createFileShell<OutpatientContext, OutpatientInstruction, OutpatientEffect>({
    commitsFile: outpatientCommitsFile,
    auditFile: join(dir, 'outpatient-audit.jsonl'),
  }).commit(outcome.value.context, outcome.value.effects);

  return outcome.value.context;
}

describe('relayOutpatientEffectsToLab', () => {
  it('processes a durably committed lab CPOE order and durably commits the OrderLabTest', async () => {
    let outpatientContext = commitOutpatientInstructions({ encounters: {}, soapNotes: {}, cpoeOrders: {} }, [
      { kind: 'CheckInPatient', encounterId: encounterId('encounter-1'), patientId: patientId('patient-1'), checkedInAt: isoTimestamp('2026-10-18T09:00:00.000Z') },
    ]);
    outpatientContext = commitOutpatientInstructions(outpatientContext, [
      {
        kind: 'PlaceCpoeOrder',
        orderId: cpoeOrderId('order-1'),
        encounterId: encounterId('encounter-1'),
        detail: { orderType: 'lab', testCode: 'CBC' },
        placedAt: isoTimestamp('2026-10-18T09:15:00.000Z'),
      },
    ]);
    void outpatientContext;

    const result = await relayOutpatientEffectsToLab(
      outpatientCommitsFile,
      createFileOutboxCursor(cursorFile),
      labShell(),
      labEngine,
      { orders: {} },
    );

    expect(result.outcomes).toEqual([
      { kind: 'not-applicable', sourceEffectKind: 'PatientCheckedIn' },
      { kind: 'ordered', orderId: 'order-1', encounterId: 'encounter-1' },
    ]);
    expect(result.processedThroughIndex).toBe(2);
    expect(readCommits(labCommitsFile)).toHaveLength(1); // check-in produced no lab commit; the order did
  });

  it('running again with no new outpatient commits processes nothing new', async () => {
    commitOutpatientInstructions({ encounters: {}, soapNotes: {}, cpoeOrders: {} }, [
      { kind: 'CheckInPatient', encounterId: encounterId('encounter-1'), patientId: patientId('patient-1'), checkedInAt: isoTimestamp('2026-10-18T09:00:00.000Z') },
    ]);

    const cursor = createFileOutboxCursor(cursorFile);
    const first = await relayOutpatientEffectsToLab(outpatientCommitsFile, cursor, labShell(), labEngine, { orders: {} });

    const second = await relayOutpatientEffectsToLab(
      outpatientCommitsFile,
      createFileOutboxCursor(cursorFile),
      labShell(),
      labEngine,
      first.context,
    );

    expect(second.outcomes).toEqual([]);
    expect(second.processedThroughIndex).toBe(1);
  });

  it('safely redelivers an already-processed order: a reset cursor reports already-ordered, not a duplicate', async () => {
    let outpatientContext = commitOutpatientInstructions({ encounters: {}, soapNotes: {}, cpoeOrders: {} }, [
      { kind: 'CheckInPatient', encounterId: encounterId('encounter-1'), patientId: patientId('patient-1'), checkedInAt: isoTimestamp('2026-10-18T09:00:00.000Z') },
    ]);
    outpatientContext = commitOutpatientInstructions(outpatientContext, [
      {
        kind: 'PlaceCpoeOrder',
        orderId: cpoeOrderId('order-1'),
        encounterId: encounterId('encounter-1'),
        detail: { orderType: 'lab', testCode: 'CBC' },
        placedAt: isoTimestamp('2026-10-18T09:15:00.000Z'),
      },
    ]);
    void outpatientContext;

    const shell = labShell();
    const first = await relayOutpatientEffectsToLab(outpatientCommitsFile, createFileOutboxCursor(cursorFile), shell, labEngine, {
      orders: {},
    });
    expect(first.outcomes).toContainEqual({ kind: 'ordered', orderId: 'order-1', encounterId: 'encounter-1' });

    const resetCursor = createFileOutboxCursor(join(dir, 'cursor-reset.jsonl'));
    const redelivered = await relayOutpatientEffectsToLab(outpatientCommitsFile, resetCursor, shell, labEngine, first.context);

    expect(redelivered.outcomes).toEqual([
      { kind: 'not-applicable', sourceEffectKind: 'PatientCheckedIn' },
      { kind: 'already-ordered', orderId: 'order-1' },
    ]);
    expect(redelivered.context.orders['order-1'].status).toBe('ordered');
  });
});
