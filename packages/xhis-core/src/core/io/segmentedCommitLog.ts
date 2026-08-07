import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CommittedBatch } from './commitLog.js';
import { appendJsonLine, ensureParentDirectory, readJsonLines } from './jsonLines.js';

/**
 * The mechanism behind "log rotation": instead of one ever-growing
 * commit file, commits are written across a *sequence* of bounded
 * segment files, each capped at `maxLinesPerSegment`. A durable
 * manifest — one line per *closed* segment, not one line per entry —
 * records each closed segment's final line count, so
 * `readSegmentedCommitsFrom` can compute where any given segment starts
 * and ends without ever opening it, and skip straight to the segment
 * that actually contains what a caller is asking for. With
 * `maxLinesPerSegment` in the thousands, even a huge total history
 * produces a small, cheap-to-read number of manifest lines — the
 * complement to `core/io/batchedRelayDriver.ts`'s fix: batching reduces
 * how *often* the whole log gets read; this bounds how much of it any
 * one read ever has to touch, regardless of total accumulated history.
 */
export interface SegmentedCommitLogConfig {
  readonly directory: string;
  readonly filePrefix: string;
  readonly maxLinesPerSegment: number;
}

interface ManifestEntry {
  readonly segmentIndex: number;
  readonly lineCount: number;
}

function manifestFile(config: SegmentedCommitLogConfig): string {
  return join(config.directory, `${config.filePrefix}.manifest.jsonl`);
}

function segmentFile(config: SegmentedCommitLogConfig, segmentIndex: number): string {
  return join(config.directory, `${config.filePrefix}.${String(segmentIndex).padStart(6, '0')}.jsonl`);
}

function readManifest(config: SegmentedCommitLogConfig): readonly ManifestEntry[] {
  return readJsonLines<ManifestEntry>(manifestFile(config));
}

export interface SegmentedCommitLogWriter<TCtx, TEffect> {
  commit(context: TCtx, effects: readonly TEffect[]): void;
}

/**
 * Resuming after a restart costs at most one *bounded* read — the
 * still-open segment's own line count, capped by `maxLinesPerSegment`
 * — never a scan of the full history, the same "no full-log re-read to
 * recover position" property `core/io/outboxCursor.ts` already gives
 * the relay side.
 */
export function createSegmentedCommitLogWriter<TCtx, TEffect>(
  config: SegmentedCommitLogConfig,
): SegmentedCommitLogWriter<TCtx, TEffect> {
  ensureParentDirectory(manifestFile(config));

  const manifest = readManifest(config);
  let currentSegmentIndex = manifest.length > 0 ? manifest[manifest.length - 1]!.segmentIndex + 1 : 0;
  let currentSegmentLineCount = existsSync(segmentFile(config, currentSegmentIndex))
    ? readJsonLines<CommittedBatch<TCtx, TEffect>>(segmentFile(config, currentSegmentIndex)).length
    : 0;

  return {
    commit(context, effects) {
      if (currentSegmentLineCount >= config.maxLinesPerSegment) {
        appendJsonLine(manifestFile(config), { segmentIndex: currentSegmentIndex, lineCount: currentSegmentLineCount });
        currentSegmentIndex += 1;
        currentSegmentLineCount = 0;
      }

      appendJsonLine(segmentFile(config, currentSegmentIndex), { context, effects });
      currentSegmentLineCount += 1;
    },
  };
}

/**
 * Reads only what's needed to answer "everything from `fromGlobalIndex`
 * onward." A manifested (closed) segment entirely before
 * `fromGlobalIndex` is skipped without ever being opened — cost is
 * bounded by how far behind the caller is, never by total accumulated
 * history. Segments beyond the manifest (the currently-open one, and —
 * in principle — any further along) aren't recorded there yet, so this
 * probes sequential indices past the manifest until one doesn't exist.
 *
 * Throws, rather than silently returning less than actually exists, if
 * a segment this call needs is missing on disk — the same "loud
 * failure over silent data loss" discipline this codebase applies
 * everywhere else (`validateInstruction`, `resolveApproval`,
 * `findBedHoldingEncounter`'s ambiguous case). This is the concrete
 * failure mode `segmentArchival.ts`'s own safety check exists to
 * prevent: archiving a segment some consumer's cursor hasn't passed yet
 * would produce exactly this error the next time that consumer runs.
 */
export function readSegmentedCommitsFrom<TCtx, TEffect>(
  config: SegmentedCommitLogConfig,
  fromGlobalIndex: number,
): readonly CommittedBatch<TCtx, TEffect>[] {
  const manifest = readManifest(config);
  const results: CommittedBatch<TCtx, TEffect>[] = [];
  let segmentStart = 0;

  for (const entry of manifest) {
    const segmentEnd = segmentStart + entry.lineCount;

    if (segmentEnd > fromGlobalIndex) {
      const path = segmentFile(config, entry.segmentIndex);
      if (!existsSync(path)) {
        throw new Error(
          `segment ${entry.segmentIndex} covers global indices [${segmentStart}, ${segmentEnd}) and is needed to read from ${fromGlobalIndex}, but is missing at ${path} — likely archived while a consumer's cursor was still behind it`,
        );
      }
      const commits = readJsonLines<CommittedBatch<TCtx, TEffect>>(path);
      const localStart = Math.max(0, fromGlobalIndex - segmentStart);
      results.push(...commits.slice(localStart));
    }

    segmentStart = segmentEnd;
  }

  let probeIndex = manifest.length > 0 ? manifest[manifest.length - 1]!.segmentIndex + 1 : 0;
  while (existsSync(segmentFile(config, probeIndex))) {
    const commits = readJsonLines<CommittedBatch<TCtx, TEffect>>(segmentFile(config, probeIndex));
    const localStart = Math.max(0, fromGlobalIndex - segmentStart);
    results.push(...commits.slice(localStart));
    segmentStart += commits.length;
    probeIndex += 1;
  }

  return results;
}
