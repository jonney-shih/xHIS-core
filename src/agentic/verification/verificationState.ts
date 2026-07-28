import { mergeDecisions } from './combineVerifiers.js';
import type { VerifyDecision } from './verifier.js';
import type { WorkerId } from './verificationWorker.js';

/**
 * Where one proposal's verification currently stands, folding verdicts
 * that arrive one at a time — possibly from different processes, over
 * time — instead of `combineVerifiers.ts`'s single synchronous call over
 * every verifier at once. `pending` carries `accumulated`: the most
 * severe decision seen so far (`{ kind: 'accept' }` if nothing has
 * reported yet), *not* just a count of who has reported — without it,
 * a `reject` seen early would be forgotten the moment a later worker's
 * `accept` folds in, silently downgrading the decision. `resolved` is
 * terminal: once folding reaches it, later verdicts (including a
 * redelivered duplicate — see below) never change it again.
 */
export type VerificationState =
  | { readonly kind: 'pending'; readonly reportedBy: readonly WorkerId[]; readonly accumulated: VerifyDecision }
  | { readonly kind: 'resolved'; readonly decision: VerifyDecision };

export function initialVerificationState(): VerificationState {
  return { kind: 'pending', reportedBy: [], accumulated: { kind: 'accept' } };
}

/**
 * Folds one worker's verdict into the running state, reusing
 * `mergeDecisions`'s "most severe wins" rule rather than reimplementing
 * it. Two things make this safe against the exact redelivery behavior
 * `runVerificationWorker` documents (a redelivered proposal can produce a
 * second, but never conflicting, record from the same worker):
 *
 * - **A worker already in `reportedBy` doesn't get counted twice** toward
 *   `requiredWorkers`, so a duplicate record can never make a proposal
 *   resolve on `reportedBy.length` alone before every *distinct* required
 *   worker has actually weighed in.
 * - **Folding the same verdict in twice is a no-op for `accumulated`**,
 *   because `mergeDecisions(decision, decision)` returns that same
 *   decision (`combineVerifiers.ts`'s severity rule is idempotent on
 *   equal inputs) — so replaying a duplicate record through this
 *   function is always safe, never double-counts severity, and never
 *   flips an already-`resolved` state (checked first, below).
 */
export function foldVerdict(
  state: VerificationState,
  reportedWorkerId: WorkerId,
  verdict: VerifyDecision,
  requiredWorkers: readonly WorkerId[],
): VerificationState {
  if (state.kind === 'resolved') {
    return state;
  }

  const accumulated = mergeDecisions(state.accumulated, verdict);

  if (accumulated.kind === 'reject') {
    // Short-circuit: no need to wait for the rest of requiredWorkers —
    // severity only ever accumulates, so nothing still to arrive could
    // walk this back below `reject`.
    return { kind: 'resolved', decision: accumulated };
  }

  const reportedBy = state.reportedBy.includes(reportedWorkerId)
    ? state.reportedBy
    : [...state.reportedBy, reportedWorkerId];

  return reportedBy.length >= requiredWorkers.length
    ? { kind: 'resolved', decision: accumulated }
    : { kind: 'pending', reportedBy, accumulated };
}

/**
 * The entry point a scheduler actually calls: fold every record a
 * `VerificationRecordStore` has for one proposal (`readAllFor`, oldest
 * first) against `requiredWorkers`, and get back where that proposal
 * currently stands. `act()`/`actHuman()` need no changes for this — a
 * scheduler calls `act()` exactly when this returns `{ kind: 'resolved' }`,
 * the same "call `act()` again once a decision arrives" flow `act()`
 * already implements for `needs-human-approval`.
 *
 * An empty `requiredWorkers` resolves to `accept` immediately, regardless
 * of `records` — the same "nothing to wait for" semantics
 * `combineVerifiers()` already has for zero verifiers. Without this,
 * misconfiguring a proposal with no required workers at all would leave
 * it `pending` forever (nothing would ever call `foldVerdict` on it),
 * silently never reaching `act()` — a footgun worth closing here rather
 * than leaving for whoever wires up the first real scheduler to discover.
 */
export function resolveVerificationState(
  records: readonly { readonly workerId: WorkerId; readonly decision: VerifyDecision }[],
  requiredWorkers: readonly WorkerId[],
): VerificationState {
  if (requiredWorkers.length === 0) {
    return { kind: 'resolved', decision: { kind: 'accept' } };
  }

  return records.reduce<VerificationState>(
    (state, record) => foldVerdict(state, record.workerId, record.decision, requiredWorkers),
    initialVerificationState(),
  );
}
