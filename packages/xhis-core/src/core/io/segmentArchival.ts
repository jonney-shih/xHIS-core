import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { OutboxCursor } from './outboxCursor.js';
import { readJsonLines } from './jsonLines.js';

interface ManifestEntry {
  readonly segmentIndex: number;
  readonly lineCount: number;
}

function manifestFile(config: { readonly directory: string; readonly filePrefix: string }): string {
  return join(config.directory, `${config.filePrefix}.manifest.jsonl`);
}

function segmentFile(config: { readonly directory: string; readonly filePrefix: string }, segmentIndex: number): string {
  return join(config.directory, `${config.filePrefix}.${String(segmentIndex).padStart(6, '0')}.jsonl`);
}

export interface SegmentArchivalResult {
  readonly archivedSegmentIndices: readonly number[];
}

/**
 * Moves closed segments out of the active directory once every
 * supplied `cursors` has advanced past them — the piece that keeps the
 * active directory's *file count* bounded too, not just what any one
 * read has to touch (`readSegmentedCommitsFrom` already bounds that on
 * its own, regardless of archival). Moving, not deleting: the data is
 * still retained (MOHW retention rules are a records-management
 * decision this reference implementation doesn't make on a
 * deployment's behalf, same reasoning `docs/AGENTIC_LAYER.md` already
 * applies to `fileShell.ts`), just relocated out of the hot path.
 *
 * `cursors` must be *every* consumer that might still need to read this
 * log live — a consumer left out of the list is a consumer this
 * function has no way to protect. With zero cursors supplied, this
 * fails closed (archives nothing) rather than guessing that "no known
 * consumers" means "safe to archive everything." A segment archived
 * while some *other*, unlisted consumer's cursor was still behind it
 * is exactly the scenario `readSegmentedCommitsFrom` throws on, rather
 * than silently returning less than actually exists — the safety net
 * this function's own check exists to make unnecessary, not the other
 * way around.
 */
export function archiveFullyProcessedSegments(
  config: { readonly directory: string; readonly filePrefix: string },
  archiveDirectory: string,
  cursors: readonly OutboxCursor[],
): SegmentArchivalResult {
  if (cursors.length === 0) {
    return { archivedSegmentIndices: [] };
  }

  const safeIndex = Math.min(...cursors.map((cursor) => cursor.read()));
  const manifest = readJsonLines<ManifestEntry>(manifestFile(config));
  const archivedSegmentIndices: number[] = [];
  let segmentStart = 0;

  mkdirSync(archiveDirectory, { recursive: true });

  for (const entry of manifest) {
    const segmentEnd = segmentStart + entry.lineCount;
    const sourcePath = segmentFile(config, entry.segmentIndex);

    if (segmentEnd <= safeIndex && existsSync(sourcePath)) {
      renameSync(sourcePath, join(archiveDirectory, basename(sourcePath)));
      archivedSegmentIndices.push(entry.segmentIndex);
    }

    segmentStart = segmentEnd;
  }

  return { archivedSegmentIndices };
}
