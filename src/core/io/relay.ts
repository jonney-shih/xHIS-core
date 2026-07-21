import type { CommittedBatch } from './commitLog.js';
import type { OutboxCursor } from './outboxCursor.js';

export interface RelayResult<TTargetCtx, TOutcome> {
  readonly context: TTargetCtx;
  readonly outcomes: readonly TOutcome[];
  readonly processedThroughIndex: number;
}

export interface ReactionResult<TTargetCtx, TOutcome, TTargetEffect> {
  readonly context: TTargetCtx;
  readonly outcomes: readonly TOutcome[];
  readonly effects: readonly TTargetEffect[];
}

/** The minimal shape a relay needs to durably persist whatever a `react`
 * call produces — a `createFileShell<TTargetCtx, ...>(...)` already
 * satisfies this structurally. */
export interface EffectCommitter<TTargetCtx, TTargetEffect> {
  commit(context: TTargetCtx, effects: readonly TTargetEffect[]): void;
}

/**
 * The domain-agnostic outbox relay, extracted once a second real
 * choreography (`integration/outboxRelayLab.ts`, alongside the original
 * `integration/outboxRelay.ts` for bed) needed the exact same loop —
 * same "extract once two real consumers prove the shape, not before"
 * precedent as `core/temporal.ts`'s `IsoTimestamp`. The loop itself never
 * had any bed-specific (or lab-specific) shape in it; `BedSelectionStrategy`
 * only ever looked like part of the relay because bed's `react` closure
 * happened to need it — it's now just a value the caller closes over.
 *
 * `readNewCommits(fromIndex)` — not a file path — supplies whatever
 * commits exist from `fromIndex` onward, as absolute-indexed entries
 * (the first returned entry corresponds to global index `fromIndex`,
 * not 0). Originally this took `sourceCommitsFile: string` directly and
 * called `readCommits` itself; generalized once `core/io/segmentedCommitLog.ts`
 * needed a second, genuinely different way to answer "give me what's
 * new" — one that never has to read a source's *entire* history to do
 * it (see docs/DETERMINISTIC_CORE_PATTERN.md's "Resolved: log rotation
 * for remote care data volume"). `outboxRelay.ts`/`outboxRelayLab.ts`
 * wrap `readCommits(file).slice(fromIndex)` in a one-line closure to
 * preserve their exact prior behavior; nothing about the loop below
 * changed.
 *
 * Tracks a durable `cursor` remembering how far it's gotten, and for
 * every unprocessed entry: runs `react`, durably commits whatever
 * effects it produced via `targetCommitter` *before* advancing the
 * cursor past that entry. A crash between those two writes means the
 * entry looks unprocessed on the next run and gets redelivered — never
 * silently skipped, which is why every `react` passed in here must
 * itself be safe to call twice for the same entry.
 *
 * The cursor advances once an entry has been *attempted*, regardless of
 * whether every reaction inside it succeeded — a delivery guarantee, not
 * a success guarantee, so one stuck entry can't block every later one.
 */
export function relayEffects<TSourceCtx, TSourceEffect, TTargetCtx, TOutcome, TTargetEffect>(
  readNewCommits: (fromIndex: number) => readonly CommittedBatch<TSourceCtx, TSourceEffect>[],
  cursor: OutboxCursor,
  targetCommitter: EffectCommitter<TTargetCtx, TTargetEffect>,
  targetContext: TTargetCtx,
  react: (
    context: TTargetCtx,
    sourceEffects: readonly TSourceEffect[],
  ) => ReactionResult<TTargetCtx, TOutcome, TTargetEffect>,
): RelayResult<TTargetCtx, TOutcome> {
  const startIndex = cursor.read();
  const newCommits = readNewCommits(startIndex);

  let context = targetContext;
  const outcomes: TOutcome[] = [];
  let processedThroughIndex = startIndex;

  for (let offset = 0; offset < newCommits.length; offset += 1) {
    const commit = newCommits[offset]!;
    const result = react(context, commit.effects);

    context = result.context;
    outcomes.push(...result.outcomes);

    if (result.effects.length > 0) {
      targetCommitter.commit(result.context, result.effects);
    }

    processedThroughIndex = startIndex + offset + 1;
    cursor.advance(processedThroughIndex);
  }

  return { context, outcomes, processedThroughIndex };
}
