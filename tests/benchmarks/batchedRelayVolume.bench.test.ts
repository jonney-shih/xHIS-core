import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBatchedRelayDriver } from '../../src/core/io/batchedRelayDriver.js';
import { createFileOutboxCursor } from '../../src/core/io/outboxCursor.js';
import { createFileShell } from '../../src/agentic/shell/fileShell.js';
import { bedEngine } from '../../src/instructions/bed/engine.js';
import { bedId, isoTimestamp as bedIsoTimestamp } from '../../src/instructions/bed/ids.js';
import type { BedContext, BedEffect, BedInstruction } from '../../src/instructions/bed/types.js';
import { EXAMPLE_firstAvailableBedStrategy } from '../../src/integration/bedSelection.js';
import { relayPatientEffectsToBed } from '../../src/integration/outboxRelay.js';

/**
 * Verifies the fix `src/core/io/batchedRelayDriver.ts` builds for what
 * `outboxRelayVolume.bench.test.ts` measured: does coalescing several
 * new source commits into one relay call actually cost less, in total,
 * than relaying after every single one, against the same kind of
 * growing historical log? Not a correctness proof — same reasoning as
 * that file for why this is deliberately excluded from `npm test` (no
 * hard timing assertion beyond "batched must beat naive," which is the
 * actual claim under test, not a machine-dependent absolute threshold).
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-batched-relay-bench-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeHistoricalCommits(commitsFile: string, count: number): void {
  const lines: string[] = new Array(count);

  for (let i = 0; i < count; i += 1) {
    lines[i] = JSON.stringify({
      context: { encounters: {} },
      effects: [
        {
          kind: 'EncounterAdmitted',
          encounterId: `encounter-${i}`,
          patientId: `patient-${i}`,
          admittedAt: '2026-07-20T00:00:00.000Z',
        },
      ],
    });
  }

  writeFileSync(commitsFile, `${lines.join('\n')}\n`, 'utf8');
}

function appendOneNewCommit(commitsFile: string, index: number): void {
  const line = JSON.stringify({
    context: { encounters: {} },
    effects: [
      {
        kind: 'EncounterAdmitted',
        encounterId: `encounter-new-${index}`,
        patientId: `patient-new-${index}`,
        admittedAt: '2026-07-20T00:00:00.000Z',
      },
    ],
  });
  writeFileSync(commitsFile, `${line}\n`, { flag: 'a' });
}

const HISTORICAL_COUNT = 20_000;
const NEW_EVENT_COUNT = 150;
const BATCH_SIZE = 15;

describe('batched relay driver, verified against the same growing log', () => {
  it('coalescing new commits into batches costs substantially less total relay time than relaying after every single one', () => {
    // --- naive: relay after every single new commit ---
    const naivePatientCommitsFile = join(dir, 'naive-patient-commits.jsonl');
    writeHistoricalCommits(naivePatientCommitsFile, HISTORICAL_COUNT);

    const naiveCursor = createFileOutboxCursor(join(dir, 'naive-cursor.jsonl'));
    naiveCursor.advance(HISTORICAL_COUNT);

    const naiveShell = createFileShell<BedContext, BedInstruction, BedEffect>({
      commitsFile: join(dir, 'naive-bed-commits.jsonl'),
      auditFile: join(dir, 'naive-bed-audit.jsonl'),
    });

    let naiveBedContext: BedContext = { beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' } } };
    let naiveTotalMs = 0;
    let naiveRelayCalls = 0;

    for (let i = 0; i < NEW_EVENT_COUNT; i += 1) {
      appendOneNewCommit(naivePatientCommitsFile, i);

      const start = performance.now();
      const result = relayPatientEffectsToBed(
        naivePatientCommitsFile,
        naiveCursor,
        naiveShell,
        bedEngine,
        naiveBedContext,
        EXAMPLE_firstAvailableBedStrategy,
        bedIsoTimestamp('2026-07-20T00:01:00.000Z'),
      );
      naiveTotalMs += performance.now() - start;
      naiveRelayCalls += 1;
      naiveBedContext = result.context;
    }

    // --- batched: coalesce BATCH_SIZE new commits per relay call ---
    const batchedPatientCommitsFile = join(dir, 'batched-patient-commits.jsonl');
    writeHistoricalCommits(batchedPatientCommitsFile, HISTORICAL_COUNT);

    const batchedCursor = createFileOutboxCursor(join(dir, 'batched-cursor.jsonl'));
    batchedCursor.advance(HISTORICAL_COUNT);

    const batchedShell = createFileShell<BedContext, BedInstruction, BedEffect>({
      commitsFile: join(dir, 'batched-bed-commits.jsonl'),
      auditFile: join(dir, 'batched-bed-audit.jsonl'),
    });

    let batchedBedContext: BedContext = { beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' } } };
    let batchedTotalMs = 0;
    let batchedRelayCalls = 0;

    // maxWaitMs is infinite on purpose — this comparison isolates the
    // count-based trigger only; the loop index below stands in for a
    // clock (fine, since the time-based branch can never fire).
    const driver = createBatchedRelayDriver({ maxPendingCount: BATCH_SIZE, maxWaitMs: Number.POSITIVE_INFINITY }, () => {
      const start = performance.now();
      const result = relayPatientEffectsToBed(
        batchedPatientCommitsFile,
        batchedCursor,
        batchedShell,
        bedEngine,
        batchedBedContext,
        EXAMPLE_firstAvailableBedStrategy,
        bedIsoTimestamp('2026-07-20T00:01:00.000Z'),
      );
      batchedTotalMs += performance.now() - start;
      batchedRelayCalls += 1;
      batchedBedContext = result.context;
      return result;
    });

    for (let i = 0; i < NEW_EVENT_COUNT; i += 1) {
      appendOneNewCommit(batchedPatientCommitsFile, i);
      driver.onCommit(i);
    }
    driver.flush(); // catches any remainder — none expected here, since NEW_EVENT_COUNT divides evenly by BATCH_SIZE

    console.log(
      `[benchmark] historical=${HISTORICAL_COUNT} newEvents=${NEW_EVENT_COUNT} batchSize=${BATCH_SIZE} ` +
        `naiveTotalMs=${naiveTotalMs.toFixed(2)} (${naiveRelayCalls} calls) ` +
        `batchedTotalMs=${batchedTotalMs.toFixed(2)} (${batchedRelayCalls} calls) ` +
        `speedup=${(naiveTotalMs / batchedTotalMs).toFixed(1)}x`,
    );

    // Correctness sanity check, not the point of this file — both
    // strategies must process every new commit exactly once, just at a
    // different granularity.
    expect(naiveRelayCalls).toBe(NEW_EVENT_COUNT);
    expect(batchedRelayCalls).toBe(Math.ceil(NEW_EVENT_COUNT / BATCH_SIZE));

    // The actual claim under test.
    expect(batchedTotalMs).toBeLessThan(naiveTotalMs);
  }, 60_000);
});
