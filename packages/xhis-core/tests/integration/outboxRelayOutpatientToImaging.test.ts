import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileShell, readCommits } from '../../src/agentic/shell/fileShell.js';
import { createFileOutboxCursor } from '../../src/core/io/outboxCursor.js';
import { imagingEngine } from '../../src/instructions/imaging/engine.js';
import type { ImagingContext, ImagingEffect, ImagingInstruction } from '../../src/instructions/imaging/types.js';
import { outpatientEngine } from '../../src/instructions/outpatient/engine.js';
import { cpoeOrderId, encounterId, isoTimestamp, patientId } from '../../src/instructions/outpatient/ids.js';
import type { OutpatientContext, OutpatientEffect, OutpatientInstruction } from '../../src/instructions/outpatient/types.js';
import { relayOutpatientEffectsToImaging } from '../../src/integration/outboxRelayOutpatientToImaging.js';

let dir: string;
let outpatientCommitsFile: string;
let imagingCommitsFile: string;
let imagingAuditFile: string;
let cursorFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-outbox-relay-outpatient-to-imaging-'));
  outpatientCommitsFile = join(dir, 'outpatient-commits.jsonl');
  imagingCommitsFile = join(dir, 'imaging-commits.jsonl');
  imagingAuditFile = join(dir, 'imaging-audit.jsonl');
  cursorFile = join(dir, 'cursor.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function imagingShell() {
  return createFileShell<ImagingContext, ImagingInstruction, ImagingEffect>({
    commitsFile: imagingCommitsFile,
    auditFile: imagingAuditFile,
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

describe('relayOutpatientEffectsToImaging', () => {
  it('processes a durably committed imaging CPOE order and durably commits the OrderStudy', async () => {
    let outpatientContext = commitOutpatientInstructions({ encounters: {}, soapNotes: {}, cpoeOrders: {} }, [
      { kind: 'CheckInPatient', encounterId: encounterId('encounter-1'), patientId: patientId('patient-1'), checkedInAt: isoTimestamp('2026-10-18T09:00:00.000Z') },
    ]);
    outpatientContext = commitOutpatientInstructions(outpatientContext, [
      {
        kind: 'PlaceCpoeOrder',
        orderId: cpoeOrderId('order-1'),
        encounterId: encounterId('encounter-1'),
        detail: { orderType: 'imaging', modality: 'CT' },
        placedAt: isoTimestamp('2026-10-18T09:15:00.000Z'),
      },
    ]);
    void outpatientContext;

    const result = await relayOutpatientEffectsToImaging(
      outpatientCommitsFile,
      createFileOutboxCursor(cursorFile),
      imagingShell(),
      imagingEngine,
      { studies: {} },
    );

    expect(result.outcomes).toEqual([
      { kind: 'not-applicable', sourceEffectKind: 'PatientCheckedIn' },
      { kind: 'ordered', studyId: 'order-1', encounterId: 'encounter-1' },
    ]);
    expect(result.processedThroughIndex).toBe(2);
    expect(readCommits(imagingCommitsFile)).toHaveLength(1);
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
        detail: { orderType: 'imaging', modality: 'CT' },
        placedAt: isoTimestamp('2026-10-18T09:15:00.000Z'),
      },
    ]);
    void outpatientContext;

    const shell = imagingShell();
    const first = await relayOutpatientEffectsToImaging(
      outpatientCommitsFile,
      createFileOutboxCursor(cursorFile),
      shell,
      imagingEngine,
      { studies: {} },
    );
    expect(first.outcomes).toContainEqual({ kind: 'ordered', studyId: 'order-1', encounterId: 'encounter-1' });

    const resetCursor = createFileOutboxCursor(join(dir, 'cursor-reset.jsonl'));
    const redelivered = await relayOutpatientEffectsToImaging(outpatientCommitsFile, resetCursor, shell, imagingEngine, first.context);

    expect(redelivered.outcomes).toEqual([
      { kind: 'not-applicable', sourceEffectKind: 'PatientCheckedIn' },
      { kind: 'already-ordered', studyId: 'order-1' },
    ]);
    expect(redelivered.context.studies['order-1'].status).toBe('ordered');
  });
});
