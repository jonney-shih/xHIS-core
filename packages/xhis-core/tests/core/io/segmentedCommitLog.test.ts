import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createSegmentedCommitLogWriter,
  readSegmentedCommitsFrom,
} from '../../../src/core/io/segmentedCommitLog.js';
import type { SegmentedCommitLogConfig } from '../../../src/core/io/segmentedCommitLog.js';

interface FakeContext {
  readonly total: number;
}

let dir: string;
let config: SegmentedCommitLogConfig;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xhis-segmented-log-'));
  config = { directory: dir, filePrefix: 'commits', maxLinesPerSegment: 3 };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function commit(writer: ReturnType<typeof createSegmentedCommitLogWriter<FakeContext, string>>, i: number): void {
  writer.commit({ total: i }, [`effect-${i}`]);
}

describe('createSegmentedCommitLogWriter + readSegmentedCommitsFrom', () => {
  it('closes a segment exactly at maxLinesPerSegment and rolls over to a new one', () => {
    const writer = createSegmentedCommitLogWriter<FakeContext, string>(config);
    for (let i = 0; i < 7; i += 1) commit(writer, i);

    const manifest = readFileSync(join(dir, 'commits.manifest.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(manifest).toEqual([
      { segmentIndex: 0, lineCount: 3 },
      { segmentIndex: 1, lineCount: 3 },
    ]);
  });

  it('reads everything from index 0 across multiple segments in order', () => {
    const writer = createSegmentedCommitLogWriter<FakeContext, string>(config);
    for (let i = 0; i < 7; i += 1) commit(writer, i);

    const commits = readSegmentedCommitsFrom<FakeContext, string>(config, 0);

    expect(commits.map((c) => c.context.total)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('resolves a fromIndex that falls in the middle of a closed segment', () => {
    const writer = createSegmentedCommitLogWriter<FakeContext, string>(config);
    for (let i = 0; i < 7; i += 1) commit(writer, i);

    expect(readSegmentedCommitsFrom<FakeContext, string>(config, 1).map((c) => c.context.total)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('resolves a fromIndex exactly at a segment boundary', () => {
    const writer = createSegmentedCommitLogWriter<FakeContext, string>(config);
    for (let i = 0; i < 7; i += 1) commit(writer, i);

    expect(readSegmentedCommitsFrom<FakeContext, string>(config, 3).map((c) => c.context.total)).toEqual([3, 4, 5, 6]);
  });

  it('resolves a fromIndex inside the still-open trailing segment', () => {
    const writer = createSegmentedCommitLogWriter<FakeContext, string>(config);
    for (let i = 0; i < 7; i += 1) commit(writer, i);

    expect(readSegmentedCommitsFrom<FakeContext, string>(config, 6).map((c) => c.context.total)).toEqual([6]);
  });

  it('returns nothing new once fromIndex has caught up to the end', () => {
    const writer = createSegmentedCommitLogWriter<FakeContext, string>(config);
    for (let i = 0; i < 7; i += 1) commit(writer, i);

    expect(readSegmentedCommitsFrom<FakeContext, string>(config, 7)).toEqual([]);
  });

  it('never opens a closed segment entirely behind fromIndex — proven by corrupting it and reading past it anyway', () => {
    const writer = createSegmentedCommitLogWriter<FakeContext, string>(config);
    for (let i = 0; i < 7; i += 1) commit(writer, i);

    // Segment 0 (global indices [0, 3)) is entirely behind fromIndex=3
    // below. If the reader ever opened it, JSON.parse would throw.
    writeFileSync(join(dir, 'commits.000000.jsonl'), 'not valid json\n');

    expect(readSegmentedCommitsFrom<FakeContext, string>(config, 3).map((c) => c.context.total)).toEqual([3, 4, 5, 6]);
  });

  it('throws, rather than silently returning less than exists, if a needed segment is missing', () => {
    const writer = createSegmentedCommitLogWriter<FakeContext, string>(config);
    for (let i = 0; i < 7; i += 1) commit(writer, i);

    // fromIndex=1 needs segment 0 (covers [0,3)) — simulate it having
    // been archived away while this cursor was still behind it.
    rmSync(join(dir, 'commits.000000.jsonl'));

    expect(() => readSegmentedCommitsFrom<FakeContext, string>(config, 1)).toThrow(/segment 0/);
  });

  it('resumes correctly after being reconstructed (a restarted process), without touching already-closed segments', () => {
    const firstWriter = createSegmentedCommitLogWriter<FakeContext, string>(config);
    for (let i = 0; i < 4; i += 1) commit(firstWriter, i); // segment 0 closed (3), segment 1 has 1 entry

    // Corrupt the closed segment — a fresh writer must not need to read
    // it to figure out where to resume.
    writeFileSync(join(dir, 'commits.000000.jsonl'), 'not valid json\n');

    const secondWriter = createSegmentedCommitLogWriter<FakeContext, string>(config);
    commit(secondWriter, 4);
    commit(secondWriter, 5); // segment 1 now at exactly 3 lines
    commit(secondWriter, 6); // this write is what actually triggers closing segment 1 — rollover is checked lazily, on the next write, not the instant the threshold is reached

    const manifest = readFileSync(join(dir, 'commits.manifest.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(manifest).toEqual([
      { segmentIndex: 0, lineCount: 3 },
      { segmentIndex: 1, lineCount: 3 },
    ]);

    // Reading from index 3 (segment 1's start) must still work, proving
    // the second writer resumed at the right position.
    expect(readSegmentedCommitsFrom<FakeContext, string>(config, 3).map((c) => c.context.total)).toEqual([3, 4, 5, 6]);
  });
});
