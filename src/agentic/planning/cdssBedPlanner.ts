import { ok, type Result } from '../../core/execution/result.js';
import { findBedHoldingEncounter } from '../../integration/bedLookup.js';
import type { BedSelectionStrategy } from '../../integration/bedSelection.js';
import { isoTimestamp, type EncounterId } from '../../instructions/bed/ids.js';
import type { BedContext } from '../../instructions/bed/types.js';
import type { PlanningGoal } from './proposal.js';
import type { RawPlanner, RawPlanOutput } from './toPlanProposal.js';

/**
 * A structured "this encounter needs a bed" signal — the bed-domain
 * counterpart to `cdssPlanner.ts`'s `TriageSignal`. Deliberately just an
 * `encounterId`: unlike triage's `severity`, there's no second dimension
 * this rule reads (see `plan`'s own doc comment for why `BedSelectionStrategy`,
 * not this signal, is where any future acuity/ward-matching sophistication
 * would go).
 */
export interface BedNeedSignal {
  readonly encounterId: EncounterId;
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
