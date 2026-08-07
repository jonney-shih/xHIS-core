import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCommits } from '../../src/core/io/commitLog.js';
import { createFileOutboxCursor } from '../../src/core/io/outboxCursor.js';
import { createFileShell } from '../../src/agentic/shell/fileShell.js';
import { bedEngine } from '../../src/instructions/bed/engine.js';
import { bedId, isoTimestamp as bedIsoTimestamp } from '../../src/instructions/bed/ids.js';
import type { BedContext, BedEffect, BedInstruction } from '../../src/instructions/bed/types.js';
import { EXAMPLE_firstAvailableBedStrategy } from '../../src/integration/bedSelection.js';
import { relayPatientEffectsToBed } from '../../src/integration/outboxRelay.js';
import type { PatientContext, PatientEffect } from '../../src/instructions/patient/types.js';

/**
 * A measurement, not a correctness proof — see
 * docs/DETERMINISTIC_CORE_PATTERN.md's "Known boundaries" entry on
 * remote care data volume, and the "Resolved" section this benchmark's
 * findings were written into. `relayEffects` (`core/io/relay.ts`) reads
 * and JSON-parses the *entire* source commit log on every call,
 * regardless of how far the cursor has already advanced — this
 * quantifies what that costs as the historical log grows toward
 * remote-monitoring volumes, where a continuous vitals stream can
 * accumulate far more entries than a discrete admission/discharge
 * workflow ever would.
 *
 * Deliberately no hard timing assertions — a threshold like "must
 * finish in under Xms" is machine-dependent and would make this file a
 * source of CI flakiness for a question that isn't about correctness.
 * Findings are read off the logged numbers and written into the doc by
 * hand; run via `npm run benchmark`, not part of `npm test`.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-outbox-volume-bench-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Writes `count` synthetic historical commit lines in one bulk write,
 * so the benchmark measures *reading* a large log, not the separate
 * question of how expensive `count` individual `appendFileSync` calls
 * would have been to produce it. */
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

const HISTORICAL_SIZES = [1_000, 10_000, 50_000, 100_000];

describe('outbox relay volume', () => {
  it.each(HISTORICAL_SIZES)(
    'cost of reading the log and relaying one new entry with %i historical entries already behind the cursor',
    (size) => {
      const patientCommitsFile = join(dir, `patient-commits-${size}.jsonl`);
      writeHistoricalCommits(patientCommitsFile, size);
      appendOneNewCommit(patientCommitsFile, size);

      const readStart = performance.now();
      const commits = readCommits<PatientContext, PatientEffect>(patientCommitsFile);
      const readElapsedMs = performance.now() - readStart;
      expect(commits).toHaveLength(size + 1);

      const cursor = createFileOutboxCursor(join(dir, `cursor-${size}.jsonl`));
      cursor.advance(size); // simulates a relay that has already caught up through the historical entries

      const emptyBedContext: BedContext = { beds: { 'bed-1': { bedId: bedId('bed-1'), status: 'available' } } };
      const shell = createFileShell<BedContext, BedInstruction, BedEffect>({
        commitsFile: join(dir, `bed-commits-${size}.jsonl`),
        auditFile: join(dir, `bed-audit-${size}.jsonl`),
      });

      const relayStart = performance.now();
      const result = relayPatientEffectsToBed(
        patientCommitsFile,
        cursor,
        shell,
        bedEngine,
        emptyBedContext,
        EXAMPLE_firstAvailableBedStrategy,
        bedIsoTimestamp('2026-07-20T00:01:00.000Z'),
      );
      const relayElapsedMs = performance.now() - relayStart;

      // Correctness sanity check, not the point of this file — confirms
      // the benchmark itself is measuring a real, working relay call,
      // not a no-op.
      expect(result.processedThroughIndex).toBe(size + 1);
      expect(result.outcomes).toEqual([{ kind: 'assigned', encounterId: `encounter-new-${size}`, bedId: 'bed-1' }]);

      console.log(
        `[benchmark] historicalEntries=${size} readCommitsMs=${readElapsedMs.toFixed(2)} relayOneNewEntryMs=${relayElapsedMs.toFixed(2)}`,
      );
    },
    30_000,
  );
});
