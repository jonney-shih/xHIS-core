import { appendJsonLine, ensureParentDirectory, readJsonLines } from '../core/io/jsonLines.js';

export interface MessageIdempotencyStore {
  hasProcessed(messageControlId: string): boolean;
  markProcessed(messageControlId: string): void;
}

/**
 * A durable *membership* store — "which specific messages have I
 * already seen," not "how far have I gotten"
 * (`core/io/outboxCursor.ts`'s `OutboxCursor`). Deliberately a
 * different data structure for a deliberately different problem: a
 * cursor works because *we* control the ordering of our own commit
 * log, so "processed" reduces to a single position. An externally
 * sourced message has no position relative to anything we own — it can
 * be redelivered by the sender's own retry logic, on any channel, at
 * any time — so recognizing a duplicate has to key off an identity the
 * message itself carries (see `externalLabResultAdapter.ts`'s
 * `messageControlId`, the same role HL7's MSH-10 plays in a real
 * interface), not off where it landed in a log we control.
 *
 * Loads every previously-seen ID into memory once, at construction, not
 * re-read on every `hasProcessed` call — appropriate for a long-lived
 * receiver process holding this open across many messages, unlike
 * `readCommits`'s deliberate "re-read the whole file every call" (safe
 * for a relay invoked occasionally, but see
 * `tests/benchmarks/outboxRelayVolume.bench.test.ts` for exactly why
 * that choice doesn't fit a high-frequency receiver).
 */
export function createFileMessageIdempotencyStore(file: string): MessageIdempotencyStore {
  ensureParentDirectory(file);
  const seen = new Set(readJsonLines<{ messageControlId: string }>(file).map((record) => record.messageControlId));

  return {
    hasProcessed(messageControlId) {
      return seen.has(messageControlId);
    },
    markProcessed(messageControlId) {
      seen.add(messageControlId);
      appendJsonLine(file, { messageControlId });
    },
  };
}
