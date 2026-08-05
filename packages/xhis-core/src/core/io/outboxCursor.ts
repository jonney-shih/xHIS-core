import { appendJsonLine, ensureParentDirectory, readLastJsonLine } from './jsonLines.js';

export interface OutboxCursor {
  /** How many entries of whatever ordered log this cursor tracks have
   * already been processed. `0` if nothing has been processed yet. */
  read(): number;
  /** Durably records that entries up through `processedThroughIndex`
   * (exclusive of anything after it) have been processed. Must only be
   * called once that work has actually, durably happened — this is the
   * one call an outbox relay makes *after* committing a reaction, never
   * before, so a crash between the two always looks like "not yet
   * processed" on restart rather than the reverse. */
  advance(processedThroughIndex: number): void;
}

/**
 * A durable, file-backed cursor — the piece that makes an outbox relay
 * (see `integration/outboxRelay.ts`) survive a restart without either
 * losing track of what's left to do or silently re-skipping something.
 * Append-only, same JSON Lines discipline as `agentic/shell/fileShell.ts`:
 * reading means reading the *last* line, there is no separate snapshot to
 * keep in sync, and a corrupted line throws on read rather than silently
 * resetting progress.
 */
export function createFileOutboxCursor(cursorFile: string): OutboxCursor {
  ensureParentDirectory(cursorFile);

  return {
    read() {
      const last = readLastJsonLine<{ processedThroughIndex: number }>(cursorFile);
      return last ? last.processedThroughIndex : 0;
    },
    advance(processedThroughIndex) {
      appendJsonLine(cursorFile, { processedThroughIndex });
    },
  };
}
