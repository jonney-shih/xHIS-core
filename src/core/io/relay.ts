import { readCommits } from './commitLog.js';
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
 * Reads the source domain's durable commit log
 * (`agentic/shell/fileShell.ts`'s `createFileShell`) and a durable
 * `cursor` remembering how far it's gotten, and for every unprocessed
 * entry: runs `react`, durably commits whatever effects it produced via
 * `targetCommitter` *before* advancing the cursor past that entry. A
 * crash between those two writes means the entry looks unprocessed on
 * the next run and gets redelivered — never silently skipped, which is
 * why every `react` passed in here must itself be safe to call twice for
 * the same entry.
 *
 * The cursor advances once an entry has been *attempted*, regardless of
 * whether every reaction inside it succeeded — a delivery guarantee, not
 * a success guarantee, so one stuck entry can't block every later one.
 */
export function relayEffects<TSourceCtx, TSourceEffect, TTargetCtx, TOutcome, TTargetEffect>(
  sourceCommitsFile: string,
  cursor: OutboxCursor,
  targetCommitter: EffectCommitter<TTargetCtx, TTargetEffect>,
  targetContext: TTargetCtx,
  react: (
    context: TTargetCtx,
    sourceEffects: readonly TSourceEffect[],
  ) => ReactionResult<TTargetCtx, TOutcome, TTargetEffect>,
): RelayResult<TTargetCtx, TOutcome> {
  const commits = readCommits<TSourceCtx, TSourceEffect>(sourceCommitsFile);
  const startIndex = cursor.read();

  let context = targetContext;
  const outcomes: TOutcome[] = [];
  let processedThroughIndex = startIndex;

  for (let index = startIndex; index < commits.length; index += 1) {
    const commit = commits[index]!;
    const result = react(context, commit.effects);

    context = result.context;
    outcomes.push(...result.outcomes);

    if (result.effects.length > 0) {
      targetCommitter.commit(result.context, result.effects);
    }

    processedThroughIndex = index + 1;
    cursor.advance(processedThroughIndex);
  }

  return { context, outcomes, processedThroughIndex };
}
