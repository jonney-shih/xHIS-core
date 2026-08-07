import { ok, type Result } from '../../core/execution/result.js';
import { findPendingBookingsForEncounter } from '../../integration/schedulingLookup.js';
import type { EncounterId, PatientId } from '../../instructions/patient/ids.js';
import type { SchedulingContext } from '../../instructions/scheduling/types.js';
import type { PatientVitalsUiComponent } from '../ui/patient.js';
import type { RawUiRenderOutput } from '../ui/toUiRenderProposal.js';
import type { PlanningGoal } from './proposal.js';
import type { RawPlanner, RawPlanOutput } from './toPlanProposal.js';

/**
 * A structured "this encounter no longer needs its outstanding bookings"
 * signal — the scheduling-domain counterpart to `cdssLabPlanner.ts`'s
 * `LabDischargeSignal`, sharing its exact shape and reasoning:
 * `patientToScheduling.ts`'s own doc comment states plainly that
 * `EncounterAdmitted` has no scheduling reaction either, "not a
 * coincidence that the same reasoning recurs a third time" after lab and
 * imaging. A booking is made by an explicit `ScheduleBooking`
 * instruction, never implied by admission, so a triage-shaped signal
 * here would invent the same kind of judgment `cdssLabPlanner.ts`
 * already declined to invent for lab.
 *
 * Carries `patientId` alongside `encounterId` for the identical reason
 * `LabDischargeSignal` gained one: `plan`'s rule below never reads it (a
 * discharge is resolved purely by encounter), but
 * `suggestVitalsEntryPanel` does — a genuine discharge signal was
 * always going to know which patient it's for.
 */
export interface SchedulingDischargeSignal {
  readonly encounterId: EncounterId;
  readonly patientId: PatientId;
}

/** Same "bundle what informs planning, not ambient state" reasoning
 * every prior CDSS context type in this codebase already gives. */
export interface CdssSchedulingContext {
  readonly schedulingContext: SchedulingContext;
  readonly signals: readonly SchedulingDischargeSignal[];
}

/**
 * The fifth real domain to get a CDSS rule implementing the untrusted
 * `RawPlanner<TCtx>` contract, after patient, bed, lab, and pharmacy.
 * The rule itself is structurally the closest of any pair so far to an
 * existing one — it is `createCdssLabPlanner`'s rule with scheduling's
 * own lookup swapped in: for every signal, recommend `CancelBooking` for
 * each booking `findPendingBookingsForEncounter` finds still
 * `'scheduled'` for that encounter. That closeness is not a coincidence
 * to paper over — `patientToScheduling.ts`'s own doc comment already
 * says the identical choreography reasoning "recurs a third time" for
 * lab, imaging, and scheduling, because booking creation genuinely
 * shares lab's and imaging's "never implied by admission" trait. Reusing
 * the identical rule shape here is the correct response to a genuinely
 * repeated situation, not a copy-paste shortcut.
 *
 * What is genuinely different, and had to be checked fresh rather than
 * assumed to hold by analogy to lab:
 *
 * 1. **`CancelBooking` lands at scheduling's own *top* tier,
 *    `'approval-required'`** — unlike lab's `CancelLabOrder`
 *    recommendation, which landed at the lower `'review-required'`.
 *    `risk/scheduling.ts`'s own doc comment gives the domain-specific
 *    reason: a cancelled `bookingId` can never be scheduled again (no
 *    undo exists at all, not even a re-booking under the same id), the
 *    same terminal-consequence shape that earns pharmacy's
 *    `DispenseMedication` its own top tier. This is only the *second*
 *    CDSS recommendation in this codebase to land at a top tier — the
 *    "not exempt from approval even at the highest stakes" claim
 *    `createCdssPharmacyPlanner`'s own doc comment first proved gets
 *    checked again here, for a different domain-specific reason.
 * 2. **Scheduling's approval policy is *disjoint*, not nested, unlike
 *    lab's or pharmacy's.** `EXAMPLE_schedulingApprovalPolicy`'s
 *    `'review-required': ['scheduling-coordinator']` and
 *    `'approval-required': ['or-director']` share no role at all — a
 *    `scheduling-coordinator` is not a weaker `or-director`, they are
 *    unrelated roles. `cdssSchedulingPlanningEndToEnd.test.ts` proves
 *    a `scheduling-coordinator` cannot approve a CDSS-recommended
 *    `CancelBooking` for that reason specifically, not because they sit
 *    one tier too low the way pharmacy's `physician` does.
 * 3. **`findPendingBookingsForEncounter` matches by convention, not by a
 *    real foreign key.** `BookingRecord.subjectId` is a plain `string`,
 *    not a branded `EncounterId` — a booking for equipment maintenance
 *    or a staff shift never has an encounter at all, and this rule
 *    correctly never recommends cancelling one, the same reasoning that
 *    module's own doc comment already gives for the choreography this
 *    planner otherwise mirrors.
 */
export function createCdssSchedulingPlanner(): RawPlanner<CdssSchedulingContext> {
  return {
    async plan(
      _goal: PlanningGoal,
      context: CdssSchedulingContext,
      proposedAt: string,
      _feedback: readonly string[],
    ): Promise<Result<RawPlanOutput, string>> {
      const instructions = context.signals.flatMap((signal) =>
        findPendingBookingsForEncounter(context.schedulingContext, signal.encounterId).map((bookingId) => ({
          kind: 'CancelBooking',
          bookingId,
          cancelledAt: proposedAt,
        })),
      );

      return ok({
        instructions,
        rationale: `CDSS scheduling rule: recommending cancellation of ${instructions.length} pending booking(s) across ${context.signals.length} discharge signal(s)`,
        // Repurposed, not misused: same reasoning every prior CDSS
        // planner in this codebase documents for its own
        // `modelVersion`/`promptVersion` — this planner has no model and
        // no prompt at all.
        modelVersion: 'cdss-scheduling-cancellation-rule-engine-v1',
        promptVersion: 'scheduling-cancellation-ruleset-v1',
      });
    },
  };
}

/**
 * Scheduling's own counterpart to `cdssLabPlanner.ts`'s
 * `suggestVitalsEntryPanel` — the same "discharge vitals" real-world
 * justification, not a fresh clinical judgment call. Scheduling's own
 * `SchedulingDischargeSignal` represents the *identical* real-world
 * event lab's `LabDischargeSignal` does — a patient discharge — the
 * same event `patientToScheduling.ts`'s own doc comment already
 * confirms "recurs" for scheduling for the identical reason it does for
 * lab and imaging. Unlike pharmacy's declined dispense-event suggestion
 * (see `docs/DETERMINISTIC_CORE_PATTERN.md`'s own section on why that
 * one was skipped), there is no per-instance judgment needed here: a
 * discharge is a discharge, regardless of which bookings it happens to
 * cancel, the same "the suggestion is tied to the event, not to
 * whether the domain's own rule found anything to act on" reasoning
 * `cdssLabPlanner.ts`'s own version already establishes.
 *
 * Returns the *raw*, still-untrusted shape `toUiRenderProposal` expects
 * — the fourth real caller of the identical `VitalsEntryPanel`
 * component, proving the same validation-gate claim again.
 */
export function suggestVitalsEntryPanel(signal: SchedulingDischargeSignal): RawUiRenderOutput {
  const component: PatientVitalsUiComponent = {
    component: 'VitalsEntryPanel',
    props: { encounterId: signal.encounterId, patientId: signal.patientId },
  };

  return {
    component,
    rationale: 'CDSS scheduling rule: suggesting discharge vitals entry for a newly recommended booking cancellation',
    modelVersion: 'cdss-scheduling-cancellation-rule-engine-v1',
    promptVersion: 'scheduling-cancellation-ruleset-v1',
  };
}
