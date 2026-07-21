import type { Kinded } from '../../core/execution/kinded.js';
import type { AuditRecord } from './auditRecord.js';

/**
 * The imperative shell docs/ARCHITECTURE.md flags as not yet built: the one
 * place actual I/O happens for the agentic layer — applying a committed
 * context/effects somewhere durable, and appending one audit record per
 * Act decision. Nothing upstream of this (handlers, Plan, Do, Check, Act's
 * own decision logic in `act.ts`) performs I/O; they only ever produce data
 * describing what should happen. `commit` and `recordAudit` are kept as two
 * separate calls, not one, because an audit record is written on every Act
 * outcome (including rejection), while `commit` is only ever called when
 * `act()` actually decides to commit.
 *
 * `TAuditRecord` defaults to `AuditRecord<TInstruction, TEffect>` so every
 * existing 3-type-argument call site keeps compiling unchanged — added
 * only so `src/human/actHuman.ts` (the human-initiated counterpart to
 * `act()`) can supply its own `HumanActionAuditRecord` shape instead of
 * being forced into the agentic-specific one, while still reusing `commit`
 * and `readLatest` verbatim. That reuse is the actual claim this document
 * already made ("nothing about `ImperativeShell` cares where a commit
 * came from") — this is what makes it true of a second, real caller
 * instead of just asserted. See `docs/DETERMINISTIC_CORE_PATTERN.md`'s
 * "Resolved: the human-initiated ImperativeShell path" for what building
 * that second caller actually required, and what it deliberately still
 * doesn't decide (whether the two paths should ever share one *audit*
 * store, not just the same shell mechanism — still open, see
 * docs/AGENTIC_LAYER.md).
 */
export interface ImperativeShell<TCtx, TInstruction extends Kinded, TEffect, TAuditRecord = AuditRecord<TInstruction, TEffect>> {
  commit(context: TCtx, effects: readonly TEffect[]): void;
  recordAudit(record: TAuditRecord): void;
  /**
   * The context as of the most recently committed batch, or `undefined`
   * if nothing has ever been committed. Added so `act()` can re-check a
   * proposal against reality immediately before writing — see
   * `act.ts`'s `'stale'` outcome and
   * `tests/agentic/shell/actStaleCommitRace.test.ts` for the race this
   * closes: without this, a proposal's Do stage could be computed
   * against a snapshot that predates another proposal's commit (e.g.
   * across a human-approval wait that spans hours), and blindly
   * committing that stale computation would silently overwrite
   * whatever committed in the meantime.
   */
  readLatest(): TCtx | undefined;
}
