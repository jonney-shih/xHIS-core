import { ok, type Result } from '../../core/execution/result.js';
import { findPendingStudiesForEncounter } from '../../integration/imagingLookup.js';
import type { EncounterId } from '../../instructions/imaging/ids.js';
import type { ImagingContext } from '../../instructions/imaging/types.js';
import type { PlanningGoal } from './proposal.js';
import type { RawPlanner, RawPlanOutput } from './toPlanProposal.js';

/**
 * A structured "this encounter no longer needs its outstanding studies"
 * signal — the imaging-domain counterpart to `cdssLabPlanner.ts`'s
 * `LabDischargeSignal` and `cdssSchedulingPlanner.ts`'s
 * `SchedulingDischargeSignal`, sharing their exact shape and reasoning.
 * `patientToImaging.ts`'s own doc comment says its choreography mirrors
 * `patientToLab.ts` "exactly" for the identical reason: a study is
 * ordered by an explicit clinical instruction, never implied by
 * admission, so recommending `OrderStudy` from a triage-shaped signal
 * would invent the same clinical judgment `cdssLabPlanner.ts` already
 * declined to invent for `OrderLabTest`.
 */
export interface ImagingDischargeSignal {
  readonly encounterId: EncounterId;
}

/** Same "bundle what informs planning, not ambient state" reasoning
 * every prior CDSS context type in this codebase already gives. */
export interface CdssImagingContext {
  readonly imagingContext: ImagingContext;
  readonly signals: readonly ImagingDischargeSignal[];
}

/**
 * The seventh real domain to get a CDSS rule implementing the untrusted
 * `RawPlanner<TCtx>` contract, after patient, bed, lab, pharmacy,
 * scheduling, and ledger. Unlike ledger's or pharmacy's own sections,
 * this one does not introduce a new tier/policy-shape combination to
 * check — it is `createCdssLabPlanner`'s rule with imaging's own lookup
 * swapped in, and every dimension that mattered for lab's own proof
 * checks out identically for imaging too:
 *
 * 1. `findPendingStudiesForEncounter` matches on a real, branded
 *    `EncounterId` foreign key (`StudyRecord.encounterId`), the same as
 *    lab's `LabOrderRecord.encounterId` — unlike scheduling's
 *    convention-only `subjectId`. `imagingLookup.ts`'s own doc comment
 *    says it "mirrors ... `findPendingLabOrdersForEncounter` exactly."
 * 2. `CancelStudy` is `'review-required'` (see `risk/imaging.ts`) — the
 *    same lower tier lab's `CancelLabOrder` recommendation lands at,
 *    not scheduling's top `'approval-required'` `CancelBooking`.
 * 3. `EXAMPLE_imagingApprovalPolicy`'s `'review-required': ['physician',
 *    'radiologic-technologist']` gives this tier two valid approvers,
 *    the same shape lab's own `'review-required'` list has.
 *
 * That this planner introduces nothing new to *prove* about the spine
 * or the approval mechanism is itself the honest finding: three domains
 * (lab, scheduling, imaging) now share the identical "discharge cancels
 * every still-pending target, one-to-many, no selection needed" real-
 * world shape, and this is the second of those three (after imaging's
 * own choreography already confirmed it for the non-agentic path) to
 * land on lab's exact tier and policy combination rather than
 * scheduling's different one — not because the rule was assumed to
 * transfer, but because `risk/imaging.ts`'s and
 * `identity/imaging.ts`'s own, independently-authored choices happened
 * to land there. What this file still proves, freshly, is that
 * *imaging's own* validators, engine, verifier, and UI panel are wired
 * together correctly for a CDSS-sourced `CancelStudy` — the generic
 * rule shape being unsurprising doesn't make the domain-specific wiring
 * check itself skippable.
 *
 * The rule: for every signal, recommend `CancelStudy` for each study
 * `findPendingStudiesForEncounter` finds still `'ordered'` for that
 * encounter. An encounter with nothing pending contributes nothing —
 * naturally idempotent, the same guarantee that lookup's own doc
 * comment already relies on for redelivery safety.
 */
export function createCdssImagingPlanner(): RawPlanner<CdssImagingContext> {
  return {
    async plan(
      _goal: PlanningGoal,
      context: CdssImagingContext,
      proposedAt: string,
      _feedback: readonly string[],
    ): Promise<Result<RawPlanOutput, string>> {
      const instructions = context.signals.flatMap((signal) =>
        findPendingStudiesForEncounter(context.imagingContext, signal.encounterId).map((studyId) => ({
          kind: 'CancelStudy',
          studyId,
          cancelledAt: proposedAt,
        })),
      );

      return ok({
        instructions,
        rationale: `CDSS imaging rule: recommending cancellation of ${instructions.length} pending study(s) across ${context.signals.length} discharge signal(s)`,
        // Repurposed, not misused: same reasoning every prior CDSS
        // planner in this codebase documents for its own
        // `modelVersion`/`promptVersion` — this planner has no model and
        // no prompt at all.
        modelVersion: 'cdss-imaging-cancellation-rule-engine-v1',
        promptVersion: 'imaging-cancellation-ruleset-v1',
      });
    },
  };
}
