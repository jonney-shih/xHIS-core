import { readJsonLines } from './jsonLines.js';

/**
 * Relocated from `agentic/shell/inMemoryShell.ts` once a second real
 * consumer outside the agentic layer (`integration/outboxRelayLab.ts`)
 * needed it directly — the same "defer relocation until a second real
 * need proves it, not before" precedent `core/temporal.ts`'s
 * `IsoTimestamp` followed. `CommittedBatch` never had any agentic-specific
 * shape (no `PlanProposal`/`VerifyDecision`, unlike `AuditRecord`); it was
 * only ever housed in the agentic layer because that's where the first
 * consumer happened to live.
 */
export interface CommittedBatch<TCtx, TEffect> {
  readonly context: TCtx;
  readonly effects: readonly TEffect[];
}

/** Reads every committed `{context, effects}` batch, oldest first. */
export function readCommits<TCtx, TEffect>(commitsFile: string): readonly CommittedBatch<TCtx, TEffect>[] {
  return readJsonLines<CommittedBatch<TCtx, TEffect>>(commitsFile);
}
