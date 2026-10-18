import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileShell, readCommits } from '../../src/agentic/shell/fileShell.js';
import { createFileOutboxCursor } from '../../src/core/io/outboxCursor.js';
import { outpatientEngine } from '../../src/instructions/outpatient/engine.js';
import { cpoeOrderId, encounterId, isoTimestamp, patientId } from '../../src/instructions/outpatient/ids.js';
import type { OutpatientContext, OutpatientEffect, OutpatientInstruction } from '../../src/instructions/outpatient/types.js';
import { pharmacyEngine } from '../../src/instructions/pharmacy/engine.js';
import type { PharmacyContext, PharmacyEffect, PharmacyInstruction } from '../../src/instructions/pharmacy/types.js';
import { relayOutpatientEffectsToPharmacy } from '../../src/integration/outboxRelayOutpatientToPharmacy.js';

let dir: string;
let outpatientCommitsFile: string;
let pharmacyCommitsFile: string;
let pharmacyAuditFile: string;
let cursorFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-outbox-relay-outpatient-to-pharmacy-'));
  outpatientCommitsFile = join(dir, 'outpatient-commits.jsonl');
  pharmacyCommitsFile = join(dir, 'pharmacy-commits.jsonl');
  pharmacyAuditFile = join(dir, 'pharmacy-audit.jsonl');
  cursorFile = join(dir, 'cursor.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function pharmacyShell() {
  return createFileShell<PharmacyContext, PharmacyInstruction, PharmacyEffect>({
    commitsFile: pharmacyCommitsFile,
    auditFile: pharmacyAuditFile,
  });
}

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

describe('relayOutpatientEffectsToPharmacy', () => {
  it('processes a durably committed pharmacy CPOE order and durably commits the PrescribeMedication', async () => {
    let outpatientContext = commitOutpatientInstructions({ encounters: {}, soapNotes: {}, cpoeOrders: {} }, [
      { kind: 'CheckInPatient', encounterId: encounterId('encounter-1'), patientId: patientId('patient-1'), checkedInAt: isoTimestamp('2026-10-18T09:00:00.000Z') },
    ]);
    outpatientContext = commitOutpatientInstructions(outpatientContext, [
      {
        kind: 'PlaceCpoeOrder',
        orderId: cpoeOrderId('order-1'),
        encounterId: encounterId('encounter-1'),
        detail: { orderType: 'pharmacy', medicationCode: 'AMOX500' },
        placedAt: isoTimestamp('2026-10-18T09:15:00.000Z'),
      },
    ]);
    void outpatientContext;

    const result = await relayOutpatientEffectsToPharmacy(
      outpatientCommitsFile,
      createFileOutboxCursor(cursorFile),
      pharmacyShell(),
      pharmacyEngine,
      { prescriptions: {} },
    );

    expect(result.outcomes).toEqual([
      { kind: 'not-applicable', sourceEffectKind: 'PatientCheckedIn' },
      { kind: 'prescribed', prescriptionId: 'order-1', encounterId: 'encounter-1' },
    ]);
    expect(result.processedThroughIndex).toBe(2);
    expect(readCommits(pharmacyCommitsFile)).toHaveLength(1);
  });

  it('safely redelivers an already-processed order: a reset cursor reports already-prescribed, not a duplicate', async () => {
    let outpatientContext = commitOutpatientInstructions({ encounters: {}, soapNotes: {}, cpoeOrders: {} }, [
      { kind: 'CheckInPatient', encounterId: encounterId('encounter-1'), patientId: patientId('patient-1'), checkedInAt: isoTimestamp('2026-10-18T09:00:00.000Z') },
    ]);
    outpatientContext = commitOutpatientInstructions(outpatientContext, [
      {
        kind: 'PlaceCpoeOrder',
        orderId: cpoeOrderId('order-1'),
        encounterId: encounterId('encounter-1'),
        detail: { orderType: 'pharmacy', medicationCode: 'AMOX500' },
        placedAt: isoTimestamp('2026-10-18T09:15:00.000Z'),
      },
    ]);
    void outpatientContext;

    const shell = pharmacyShell();
    const first = await relayOutpatientEffectsToPharmacy(
      outpatientCommitsFile,
      createFileOutboxCursor(cursorFile),
      shell,
      pharmacyEngine,
      { prescriptions: {} },
    );
    expect(first.outcomes).toContainEqual({ kind: 'prescribed', prescriptionId: 'order-1', encounterId: 'encounter-1' });

    const resetCursor = createFileOutboxCursor(join(dir, 'cursor-reset.jsonl'));
    const redelivered = await relayOutpatientEffectsToPharmacy(outpatientCommitsFile, resetCursor, shell, pharmacyEngine, first.context);

    expect(redelivered.outcomes).toEqual([
      { kind: 'not-applicable', sourceEffectKind: 'PatientCheckedIn' },
      { kind: 'already-prescribed', prescriptionId: 'order-1' },
    ]);
    expect(redelivered.context.prescriptions['order-1'].status).toBe('prescribed');
  });
});
