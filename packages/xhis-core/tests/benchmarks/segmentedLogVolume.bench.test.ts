import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCommits } from '../../src/core/io/commitLog.js';
import { readSegmentedCommitsFrom } from '../../src/core/io/segmentedCommitLog.js';
import type { SegmentedCommitLogConfig } from '../../src/core/io/segmentedCommitLog.js';

/**
 * Verifies the stronger claim `core/io/segmentedCommitLog.ts` makes
 * over `core/io/batchedRelayDriver.ts`'s fix: batching reduces how
 * *often* the full log gets read (a constant-factor win); segmentation
 * is supposed to make one read's cost *independent of total history
 * size* entirely, as long as the caller is asking for something recent.
 * This holds the "how far behind" window constant and grows total
 * history across three orders of magnitude, comparing single-file
 * `readCommits` (must scan everything) against `readSegmentedCommitsFrom`
 * (should only ever touch the tail). No hard timing assertions — same
 * reasoning as `outboxRelayVolume.bench.test.ts` for why this file is
 * diagnostic, not a CI gate. Run via `npm run benchmark`.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-segmented-volume-bench-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSingleFileCommits(file: string, count: number): void {
  const lines: string[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    lines[i] = JSON.stringify({ context: { total: i }, effects: [`effect-${i}`] });
  }
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

/**
 * Constructs the exact on-disk layout `createSegmentedCommitLogWriter`
 * would produce, via bulk writes rather than `count` individual
 * `commit()` calls — this benchmark measures *read* cost, so setup
 * should stay fast regardless of size, not be dominated by however
 * expensive `count` real appends would be.
 */
function writeSegmentedCommitsBulk(config: SegmentedCommitLogConfig, count: number): void {
  mkdirSync(config.directory, { recursive: true });

  const manifestLines: string[] = [];
  let segmentIndex = 0;
  let i = 0;

  while (i < count) {
    const segmentEnd = Math.min(i + config.maxLinesPerSegment, count);
    const lines: string[] = [];
    for (let j = i; j < segmentEnd; j += 1) {
      lines.push(JSON.stringify({ context: { total: j }, effects: [`effect-${j}`] }));
    }

    const segmentFile = join(config.directory, `${config.filePrefix}.${String(segmentIndex).padStart(6, '0')}.jsonl`);
    writeFileSync(segmentFile, `${lines.join('\n')}\n`, 'utf8');

    const isFinalSegment = segmentEnd === count;
    if (!isFinalSegment) {
      manifestLines.push(JSON.stringify({ segmentIndex, lineCount: lines.length }));
    }

    segmentIndex += 1;
    i = segmentEnd;
  }

  if (manifestLines.length > 0) {
    writeFileSync(join(config.directory, `${config.filePrefix}.manifest.jsonl`), `${manifestLines.join('\n')}\n`, 'utf8');
  }
}

const TOTAL_SIZES = [10_000, 100_000, 1_000_000];
const TAIL_WINDOW = 100; // how far behind the cursor is — held constant as total history grows
const SEGMENT_SIZE = 10_000;

describe('segmented vs single-file read cost as total history grows', () => {
  it.each(TOTAL_SIZES)(
    'reading the last %i entries: single-file cost should grow with total history, segmented cost should not',
    (total) => {
      const singleFile = join(dir, `single-${total}.jsonl`);
      writeSingleFileCommits(singleFile, total);

      const singleStart = performance.now();
      const singleResult = readCommits<{ total: number }, string>(singleFile).slice(total - TAIL_WINDOW);
      const singleElapsedMs = performance.now() - singleStart;

      const segmentedConfig: SegmentedCommitLogConfig = {
        directory: join(dir, `segmented-${total}`),
        filePrefix: 'commits',
        maxLinesPerSegment: SEGMENT_SIZE,
      };
      writeSegmentedCommitsBulk(segmentedConfig, total);

      const segmentedStart = performance.now();
      const segmentedResult = readSegmentedCommitsFrom<{ total: number }, string>(segmentedConfig, total - TAIL_WINDOW);
      const segmentedElapsedMs = performance.now() - segmentedStart;

      // Correctness sanity check, not the point of this file — both
      // approaches must agree on exactly which entries are "new".
      expect(singleResult).toHaveLength(TAIL_WINDOW);
      expect(segmentedResult).toHaveLength(TAIL_WINDOW);
      expect(segmentedResult.map((c) => c.context.total)).toEqual(singleResult.map((c) => c.context.total));

      console.log(
        `[benchmark] totalHistory=${total} tailWindow=${TAIL_WINDOW} ` +
          `singleFileMs=${singleElapsedMs.toFixed(2)} segmentedMs=${segmentedElapsedMs.toFixed(2)}`,
      );
    },
    60_000,
  );
});
