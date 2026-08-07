import { ok, type Result } from '../../core/execution/result.js';
import { findBedHoldingEncounter } from '../../integration/bedLookup.js';
import type { BedSelectionStrategy } from '../../integration/bedSelection.js';
import { isoTimestamp, type EncounterId } from '../../instructions/bed/ids.js';
import type { BedContext } from '../../instructions/bed/types.js';
import type { PatientId } from '../../instructions/patient/ids.js';
import type { PatientVitalsUiComponent } from '../ui/patient.js';
import type { RawUiRenderOutput } from '../ui/toUiRenderProposal.js';
import type { PlanningGoal } from './proposal.js';
import type { RawPlanner, RawPlanOutput } from './toPlanProposal.js';

/**
 * A structured "this encounter needs a bed" signal — the bed-domain
 * counterpart to `cdssPlanner.ts`'s `TriageSignal`. Carries `patientId`
 * alongside `encounterId` for the identical reason `TriageSignal` does:
 * a real bed-need event always knows which patient it's for, not just
 * which encounter — nothing about `plan`'s own rule reads `patientId`
 * (it has no second dimension to react to, unlike triage's `severity`;
 * see `plan`'s own doc comment for why `BedSelectionStrategy`, not this
 * signal, is where any future acuity/ward-matching sophistication would
 * go), but `suggestVitalsEntryPanel` below does — a vitals-entry
 * suggestion is a patient-level UI action, and a form for "whose vitals"
 * needs to name a patient, not just an encounter.
 */
export interface BedNeedSignal {
  readonly encounterId: EncounterId;
  readonly patientId: PatientId;
}

/**
 * `RawPlanner<TCtx>`'s `TCtx` is "whatever informs planning" — same
 * reasoning `CdssTriageContext`'s own doc comment gives. Bundling the
 * current `BedContext` and the selection policy alongside `signals`
 * keeps `plan` a pure function of its own arguments, and makes the
 * selection *policy* itself an explicit input rather than a hardcoded
 * import — the same reason `reactToPatientEffect` takes a
 * `BedSelectionStrategy` parameter instead of calling
 * `EXAMPLE_firstAvailableBedStrategy` directly.
 */
export interface CdssBedContext {
  readonly bedContext: BedContext;
  readonly signals: readonly BedNeedSignal[];
  readonly strategy: BedSelectionStrategy;
}

/**
 * The second real domain (after patient's `createCdssTriagePlanner`) to
 * get a CDSS rule implementing the untrusted `RawPlanner<TCtx>` contract
 * — same "risk-tiered human approval regardless of how deterministic the
 * source rule was" principle, now proven against a domain that also has
 * an *existing*, unrelated automatic path for the same real-world event:
 * `patientToBed.ts`'s `EncounterAdmitted` choreography already assigns a
 * bed immediately, with no Check/Approve gate at all, the moment a
 * patient is admitted. This planner is not that path, and does not
 * replace it — it is a third, independent way to arrive at the exact
 * same `AssignBed` instruction shape: a caller (a nurse-manager's bed
 * board sweep, a rule that watches for something choreography's single
 * `EncounterAdmitted` trigger doesn't cover) that wants an *Agent-Checked,
 * human-approved* recommendation rather than an immediate, unapproved
 * commit. Both existing side by side, for the identical `AssignBed`
 * shape, triggered by structurally similar signals, is not redundancy —
 * it is the whole point: nothing about Plan/Check/Approve/Act being
 * available for a domain forces every real caller to go through it, the
 * same way `actHuman()` and choreography already coexisted for bed
 * before this file existed.
 *
 * The rule itself: for every signal whose encounter doesn't already
 * hold a bed (`findBedHoldingEncounter` — reused, not reimplemented, the
 * same lookup `patientToBed.ts`'s own choreography already trusts) and
 * for which `strategy.selectAvailableBed` finds one, recommend
 * `AssignBed`. A signal for an encounter that's already assigned, or
 * whose current bed-holding state is data-integrity `ambiguous`, is
 * skipped, not re-proposed or hard-failed — the same idempotency
 * discipline `createCdssTriagePlanner` applies to already-admitted
 * encounters, and the same "report, don't silently resolve, but don't
 * let one bad record block the rest of the batch" discipline
 * `reactToPatientEffects` already applies to the identical `ambiguous`
 * case.
 *
 * The one genuinely new wrinkle triage's planner never had to handle:
 * bed availability is a *shared, exhaustible* resource across signals in
 * the same proposal, where triage's admission target space never runs
 * out. Processing signals against a plain, unthreaded `context.bedContext`
 * would let two different signals in the same batch both be recommended
 * the *same* available bed — a real double-booking bug, not a
 * theoretical one, since `bedEngine.executeSequence` would only catch it
 * later at Do time as a `BedAlreadyOccupied` failure for the second
 * instruction, after this planner had already claimed success. Instead,
 * each accepted recommendation immediately updates a local, hypothetical
 * copy of `BedContext` (marking that bed occupied) before the next
 * signal is considered — never mutating `context.bedContext` itself, and
 * never actually committing anything; Do/Check/Act downstream still see
 * only the real, unmodified starting `BedContext` `plan`'s caller passed
 * in as their `baselineContext`.
 */
export function createCdssBedPlanner(): RawPlanner<CdssBedContext> {
  return {
    async plan(
      _goal: PlanningGoal,
      context: CdssBedContext,
      proposedAt: string,
      _feedback: readonly string[],
    ): Promise<Result<RawPlanOutput, string>> {
      const instructions: unknown[] = [];
      let hypotheticalContext = context.bedContext;

      for (const signal of context.signals) {
        const existing = findBedHoldingEncounter(hypotheticalContext, signal.encounterId);

        if (existing.kind !== 'not-found') {
          continue;
        }

        const selectedBedId = context.strategy.selectAvailableBed(hypotheticalContext);

        if (!selectedBedId) {
          continue;
        }

        instructions.push({
          kind: 'AssignBed',
          bedId: selectedBedId,
          encounterId: signal.encounterId,
          assignedAt: proposedAt,
        });

        hypotheticalContext = {
          beds: {
            ...hypotheticalContext.beds,
            [selectedBedId]: {
              ...hypotheticalContext.beds[selectedBedId],
              status: 'occupied',
              encounterId: signal.encounterId,
              assignedAt: isoTimestamp(proposedAt),
            },
          },
        };
      }

      return ok({
        instructions,
        rationale: `CDSS bed-assignment rule: recommending assignment for ${instructions.length} signal(s) needing a bed`,
        // Repurposed, not misused: same reasoning `createCdssTriagePlanner`
        // documents for its own `modelVersion`/`promptVersion` — this
        // planner has no model and no prompt at all.
        modelVersion: 'cdss-bed-assignment-rule-engine-v1',
        promptVersion: 'bed-assignment-ruleset-v1',
      });
    },
  };
}

/**
 * Bed's own counterpart to `cdssPlanner.ts`'s `suggestVitalsEntryPanel`
 * — deliberately the *same* component, not a bed-specific lookalike.
 * `VitalsEntryPanel` (Guardrail #2's own "vital sign entries" example)
 * is a patient-level UI action: a vitals-entry form needs to know which
 * patient's vitals it's collecting, a fact that has nothing to do with
 * which domain's rule happened to notice the need for one. Triage
 * noticing it (an admission) and bed noticing it (a bed assignment) are
 * two independent, real reasons the identical suggestion is worth
 * making — reusing `PatientVitalsUiComponent`/
 * `patientVitalsComponentPropsValidators` from `ui/patient.ts` is the
 * same "the concept belongs to the domain that actually owns it, don't
 * redefine a same-shaped-but-different type" reasoning
 * `instructions/bed/ids.ts` already applies to re-exporting `EncounterId`
 * from patient rather than rebranding a second one.
 *
 * Returns the *raw*, still-untrusted shape `toUiRenderProposal` expects
 * — same "being deterministic doesn't exempt this output from the same
 * validation gate an LLM's raw JSON would have to pass through" claim
 * `cdssPlanner.ts`'s own `suggestVitalsEntryPanel` already proved for
 * patient, now proven again for a second real caller of the identical
 * component.
 */
export function suggestVitalsEntryPanel(signal: BedNeedSignal): RawUiRenderOutput {
  const component: PatientVitalsUiComponent = {
    component: 'VitalsEntryPanel',
    props: { encounterId: signal.encounterId, patientId: signal.patientId },
  };

  return {
    component,
    rationale: 'CDSS bed-assignment rule: suggesting vitals entry for a newly recommended bed assignment',
    modelVersion: 'cdss-bed-assignment-rule-engine-v1',
    promptVersion: 'bed-assignment-ruleset-v1',
  };
}
