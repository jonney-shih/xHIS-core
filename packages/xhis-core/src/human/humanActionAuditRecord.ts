import type { Kinded } from '../core/execution/kinded.js';
import type { Approval } from '../agentic/shell/auditRecord.js';

/**
 * What `actHuman()` decided to do with a directly-issued instruction
 * sequence — the human-path counterpart to `CommitOutcome`
 * (`agentic/shell/auditRecord.ts`), deliberately not the same type.
 * There is no `'awaiting-approval'` here: nobody is waiting on a
 * separate approver, the actor either holds a sufficient role right now
 * or doesn't. There is also no `'stale'` here, unlike `act()`'s
 * `CommitOutcome` — `act()` needs it because a proposal's Do stage can
 * be computed long before Act runs (across a human-approval wait), so
 * the two can genuinely disagree; `actHuman()` only ever calls
 * `reexecute` once, immediately before commit, against the freshest
 * state available, so there is no earlier, possibly-stale computation
 * for a later failure to contradict — a plain `'rejected'` already says
 * everything there is to say.
 */
export type HumanActionOutcome = 'committed' | 'unauthorized' | 'rejected';

/**
 * The human-path counterpart to `AuditRecord` — deliberately a distinct
 * shape, not `AuditRecord` reused with placeholder fields. `AuditRecord`
 * carries agent-specific provenance (`proposal.rationale`,
 * `modelVersion`, `promptVersion`, `decision`) describing an AI's
 * proposal and Check's verdict on it; none of that exists for an
 * instruction sequence a human issued directly — there was no proposal,
 * and no separate Check step ran. Forcing this into `AuditRecord`'s
 * shape (e.g. `modelVersion: 'human'`) would misrepresent what actually
 * happened rather than honestly describe it.
 */
export interface HumanActionAuditRecord<TInstruction extends Kinded, TEffect> {
  readonly instructions: readonly TInstruction[];
  readonly outcome: HumanActionOutcome;
  readonly reasons: readonly string[];
  /** Only populated when `outcome` is `'committed'` — mirrors
   * `AuditRecord.effects`'s same restriction. */
  readonly effects: readonly TEffect[];
  /** Present only once `resolveActorForInstructions` has resolved the
   * actor's claim to a real, role-checked identity — absent when
   * `outcome` is `'unauthorized'`, mirroring `AuditRecord.approval`'s
   * same optionality. */
  readonly actor?: Approval;
  readonly recordedAt: string;
}
