import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { archiveFullyProcessedSegments } from '../../../src/core/io/segmentArchival.js';
import {
  createSegmentedCommitLogWriter,
  readSegmentedCommitsFrom,
} from '../../../src/core/io/segmentedCommitLog.js';
import { createFileOutboxCursor } from '../../../src/core/io/outboxCursor.js';
import type { SegmentedCommitLogConfig } from '../../../src/core/io/segmentedCommitLog.js';

interface FakeContext {
  readonly total: number;
}

let dir: string;
let config: SegmentedCommitLogConfig;
let archiveDirectory: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-segment-archival-'));
  config = { directory: dir, filePrefix: 'commits', maxLinesPerSegment: 3 };
  archiveDirectory = join(dir, 'archive');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSevenCommits(): void {
  const writer = createSegmentedCommitLogWriter<FakeContext, string>(config);
  for (let i = 0; i < 7; i += 1) writer.commit({ total: i }, [`effect-${i}`]);
  // 7 commits, maxLinesPerSegment=3 -> segment 0 [0,3) closed, segment 1 [3,6) closed, segment 2 [6,7) open
}

describe('archiveFullyProcessedSegments', () => {
  it('archives nothing when no cursors are supplied — fails closed, not open', () => {
    writeSevenCommits();

    const result = archiveFullyProcessedSegments(config, archiveDirectory, []);

    expect(result.archivedSegmentIndices).toEqual([]);
    expect(existsSync(join(dir, 'commits.000000.jsonl'))).toBe(true);
  });

  it('archives every closed segment fully behind every supplied cursor', () => {
    writeSevenCommits();
    const cursor = createFileOutboxCursor(join(dir, 'cursor.jsonl'));
    cursor.advance(7); // fully caught up

    const result = archiveFullyProcessedSegments(config, archiveDirectory, [cursor]);

    // Both closed segments (covering [0,3) and [3,6)) are behind index 7.
    // The still-open segment 2 has no manifest entry and is never a
    // candidate for archival at all.
    expect(result.archivedSegmentIndices).toEqual([0, 1]);
    expect(existsSync(join(dir, 'commits.000000.jsonl'))).toBe(false);
    expect(existsSync(join(dir, 'commits.000001.jsonl'))).toBe(false);
    expect(existsSync(join(archiveDirectory, 'commits.000000.jsonl'))).toBe(true);
    expect(existsSync(join(archiveDirectory, 'commits.000001.jsonl'))).toBe(true);
    // The open segment stays in place — untouched, not even considered.
    expect(existsSync(join(dir, 'commits.000002.jsonl'))).toBe(true);
  });

  it('does not archive a segment that any one cursor has not yet passed, even if others have', () => {
    writeSevenCommits();
    const caughtUp = createFileOutboxCursor(join(dir, 'cursor-caught-up.jsonl'));
    caughtUp.advance(7);
    const laggingBehind = createFileOutboxCursor(join(dir, 'cursor-lagging.jsonl'));
    laggingBehind.advance(2); // still inside segment 0's own range [0,3)

    const result = archiveFullyProcessedSegments(config, archiveDirectory, [caughtUp, laggingBehind]);

    // safeIndex = min(7, 2) = 2 — segment 0 covers [0,3), not fully
    // behind 2, so it must not be archived either, even though segment
    // 1 [3,6) definitely isn't safe and segment 0 is "almost" safe.
    expect(result.archivedSegmentIndices).toEqual([]);
    expect(existsSync(join(dir, 'commits.000000.jsonl'))).toBe(true);
  });

  it('leaves a partially-safe manifest correctly split: archives the segments behind the slowest cursor, keeps the rest', () => {
    writeSevenCommits();
    const cursor = createFileOutboxCursor(join(dir, 'cursor.jsonl'));
    cursor.advance(3); // exactly at segment 0's end, segment 1 not yet reached

    const result = archiveFullyProcessedSegments(config, archiveDirectory, [cursor]);

    expect(result.archivedSegmentIndices).toEqual([0]);
    expect(existsSync(join(dir, 'commits.000000.jsonl'))).toBe(false);
    expect(existsSync(join(dir, 'commits.000001.jsonl'))).toBe(true);
  });

  it('a consumer left out of the cursor list is exactly the unsafe case readSegmentedCommitsFrom guards against', () => {
    writeSevenCommits();
    const knownCursor = createFileOutboxCursor(join(dir, 'cursor.jsonl'));
    knownCursor.advance(7);

    // A second, real consumer that was never told about — e.g. a
    // forgotten integration, or a retrospective audit tool — is still
    // sitting at index 1, needing segment 0.
    archiveFullyProcessedSegments(config, archiveDirectory, [knownCursor]);

    expect(() => readSegmentedCommitsFrom<FakeContext, string>(config, 1)).toThrow(/segment 0/);
  });
});
