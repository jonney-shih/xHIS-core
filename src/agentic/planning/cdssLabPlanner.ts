import { ok, type Result } from '../../core/execution/result.js';
import { findPendingLabOrdersForEncounter } from '../../integration/labLookup.js';
import type { EncounterId } from '../../instructions/lab/ids.js';
import type { LabContext } from '../../instructions/lab/types.js';
import type { PlanningGoal } from './proposal.js';
import type { RawPlanner, RawPlanOutput } from './toPlanProposal.js';

/**
 * A structured "this encounter no longer needs its outstanding lab
 * orders" signal — the lab-domain counterpart to `cdssPlanner.ts`'s
 * `TriageSignal` and `cdssBedPlanner.ts`'s `BedNeedSignal`. Named for
 * the one real trigger `patientToLab.ts`'s own choreography reaction
 * already recognizes for this domain — a discharge — not a generic
 * "need" signal: that file's own doc comment is explicit that
 * `EncounterAdmitted` has *no* lab reaction at all, because ordering a
 * test requires real clinical judgment about *which* test, something
 * this codebase has no authority to invent (same restraint `lab/types.ts`'s
 * `testCode` staying a plain string already applies). A CDSS signal
 * shaped like triage's ("this admission implies these lab orders")
 * would need to invent exactly that judgment; this signal doesn't,
 * because cancellation needs no clinical content at all — only a lookup.
 */
export interface LabDischargeSignal {
  readonly encounterId: EncounterId;
}

/** Same "bundle what informs planning, not ambient state" reasoning
 * `CdssTriageContext`'s and `CdssBedContext`'s own doc comments give. */
export interface CdssLabContext {
  readonly labContext: LabContext;
  readonly signals: readonly LabDischargeSignal[];
}

/**
 * The third real domain (after patient's `createCdssTriagePlanner` and
 * bed's `createCdssBedPlanner`) to get a CDSS rule implementing the
 * untrusted `RawPlanner<TCtx>` contract — and, like bed's, a third
 * coexisting path to an instruction shape `patientToLab.ts`'s own
 * choreography can already produce immediately and without a
 * Check/Approve gate. Same reasoning `createCdssBedPlanner`'s own doc
 * comment gives in full for why that's not redundant: nothing about
 * Plan/Check/Approve/Act existing forces every real caller through it.
 *
 * The rule: for every signal, recommend `CancelLabOrder` for each order
 * `findPendingLabOrdersForEncounter` finds still pending for that
 * encounter — reused, not reimplemented, the same lookup
 * `patientToLab.ts`'s own choreography already trusts. An encounter with
 * nothing pending (already resulted, already cancelled, or never had an
 * order) contributes nothing — naturally idempotent, since
 * `findPendingLabOrdersForEncounter` itself only ever returns orders
 * still in `'ordered'` status, the identical guarantee that file's own
 * doc comment already relies on for redelivery safety.
 *
 * Two real differences from `createCdssBedPlanner`, both already
 * predicted by `patientToLab.ts`'s own doc comment contrasting itself
 * with `patientToBed.ts` before this planner ever existed:
 *
 * 1. **No selection policy, and so no cross-signal resource-contention
 *    wrinkle.** Bed's planner has to thread a hypothetical `BedContext`
 *    forward across signals because bed availability is shared and
 *    exhaustible; cancelling a lab order is purely lookup-driven, one
 *    encounter's pending orders never contend with another's, so this
 *    planner can map every signal to its instructions completely
 *    independently, with no shared state to thread at all.
 * 2. **A many-to-one signal shape.** Triage's and bed's rules each map
 *    one signal to at most one instruction. One discharge signal here
 *    can produce zero, one, or many `CancelLabOrder` instructions — one
 *    per still-pending order — the same "zero, one, or many, with no
 *    'which one' decision to make" shape `patientToLab.ts`'s own
 *    `PatientLabReaction` already has for the identical real-world
 *    trigger.
 */
export function createCdssLabPlanner(): RawPlanner<CdssLabContext> {
  return {
    async plan(
      _goal: PlanningGoal,
      context: CdssLabContext,
      proposedAt: string,
      _feedback: readonly string[],
    ): Promise<Result<RawPlanOutput, string>> {
      const instructions = context.signals.flatMap((signal) =>
        findPendingLabOrdersForEncounter(context.labContext, signal.encounterId).map((orderId) => ({
          kind: 'CancelLabOrder',
          orderId,
          cancelledAt: proposedAt,
        })),
      );

      return ok({
        instructions,
        rationale: `CDSS lab rule: recommending cancellation of ${instructions.length} pending order(s) across ${context.signals.length} discharge signal(s)`,
        // Repurposed, not misused: same reasoning `createCdssTriagePlanner`
        // and `createCdssBedPlanner` document for their own
        // `modelVersion`/`promptVersion` — this planner has no model and
        // no prompt at all.
        modelVersion: 'cdss-lab-cancellation-rule-engine-v1',
        promptVersion: 'lab-cancellation-ruleset-v1',
      });
    },
  };
}
