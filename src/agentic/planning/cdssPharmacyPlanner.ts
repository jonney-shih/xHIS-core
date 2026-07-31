import { ok, type Result } from '../../core/execution/result.js';
import type { PrescriptionId } from '../../instructions/pharmacy/ids.js';
import type { PharmacyContext } from '../../instructions/pharmacy/types.js';
import type { PlanningGoal } from './proposal.js';
import type { RawPlanner, RawPlanOutput } from './toPlanProposal.js';

/**
 * A structured "this prescription is up for dispensing" signal — the
 * pharmacy-domain counterpart to `cdssPlanner.ts`'s `TriageSignal`,
 * `cdssBedPlanner.ts`'s `BedNeedSignal`, and `cdssLabPlanner.ts`'s
 * `LabDischargeSignal`. Carries `prescriptionId`, not `encounterId` —
 * unlike bed's or lab's signal, which each name an *encounter* and let
 * the rule find or select the domain-specific target, dispensing already
 * has a specific, named prescription to act on; there is nothing to
 * look up or select. The one thing this rule still must not do is
 * recommend *prescribing* anything: that would require inventing which
 * medication to prescribe, the exact clinical judgment `cdssLabPlanner.ts`'s
 * own doc comment already declines to invent for lab's `OrderLabTest`.
 * Dispensing an already-prescribed medication needs no such judgment —
 * only confirming the prescription is still pending.
 */
export interface PharmacyDispenseReadySignal {
  readonly prescriptionId: PrescriptionId;
}

/** Same "bundle what informs planning, not ambient state" reasoning
 * `CdssTriageContext`'s, `CdssBedContext`'s, and `CdssLabContext`'s own
 * doc comments give. */
export interface CdssPharmacyContext {
  readonly pharmacyContext: PharmacyContext;
  readonly signals: readonly PharmacyDispenseReadySignal[];
}

/**
 * The fourth real domain to get a CDSS rule implementing the untrusted
 * `RawPlanner<TCtx>` contract, after patient's `createCdssTriagePlanner`,
 * bed's `createCdssBedPlanner`, and lab's `createCdssLabPlanner`. Unlike
 * all three of those, pharmacy has no existing choreography reaction at
 * all — there is no `patientToPharmacy.ts` the way there's a
 * `patientToBed.ts`/`patientToLab.ts` — so this planner is pharmacy's
 * *first* automated path to any instruction, not a third one coexisting
 * alongside an immediate, unapproved reaction the way bed's and lab's
 * own doc comments describe for theirs.
 *
 * The rule: for every signal whose named prescription is still
 * `'prescribed'` (not yet dispensed) in `context.pharmacyContext`,
 * recommend `DispenseMedication`. A signal naming an unknown
 * `prescriptionId`, or one already `'dispensed'`, is skipped — the same
 * idempotency discipline every prior CDSS rule in this codebase applies
 * to its own already-resolved case. A `prescriptionId` signaled more
 * than once in the same batch is recommended at most once — the
 * duplicate-target concern `createCdssBedPlanner`'s own doc comment
 * documents for *contended, shared* resources turns out to matter here
 * too, for an entirely different reason: not because two different
 * signals might compete for one scarce bed, but because
 * `bedEngine.executeSequence`'s (and every other domain's own engine's)
 * all-or-nothing batch contract means two `DispenseMedication`
 * instructions for the identical `prescriptionId` in one proposal would
 * doom the *whole* batch at Do time — the second instruction finding
 * the first one's hypothetical effect already applied and failing with
 * `PrescriptionNotPending` — not just waste one recommendation.
 *
 * The genuinely new proof this planner adds that none of the first
 * three needed: `DispenseMedication` is `'approval-required'`,
 * pharmacy's own top tier, `pharmacist`-only (see `risk/pharmacy.ts`).
 * Every prior CDSS recommendation — `AdmitPatient`, `AssignBed`,
 * `CancelLabOrder` — landed at the *lower* `'review-required'` tier.
 * "CDSS is not exempt from risk-tiered human approval... regardless of
 * how deterministic the source rule was" (docs/DETERMINISTIC_CORE_PATTERN.md's
 * own claim) had, until this planner, only ever been proven at that
 * lower tier. `cdssPharmacyPlanningEndToEnd.test.ts` proves it holds at
 * the highest-stakes tier too: a physician — permitted at
 * `'review-required'` but not `'approval-required'` — still cannot
 * approve a CDSS-recommended dispense; only a pharmacist can.
 */
export function createCdssPharmacyPlanner(): RawPlanner<CdssPharmacyContext> {
  return {
    async plan(
      _goal: PlanningGoal,
      context: CdssPharmacyContext,
      proposedAt: string,
      _feedback: readonly string[],
    ): Promise<Result<RawPlanOutput, string>> {
      const alreadyRecommended = new Set<string>();
      const instructions: unknown[] = [];

      for (const signal of context.signals) {
        const prescriptionIdKey = signal.prescriptionId as string;

        if (alreadyRecommended.has(prescriptionIdKey)) {
          continue;
        }

        const prescription = context.pharmacyContext.prescriptions[prescriptionIdKey];

        if (!prescription || prescription.status !== 'prescribed') {
          continue;
        }

        alreadyRecommended.add(prescriptionIdKey);
        instructions.push({
          kind: 'DispenseMedication',
          prescriptionId: signal.prescriptionId,
          dispensedAt: proposedAt,
        });
      }

      return ok({
        instructions,
        rationale: `CDSS pharmacy rule: recommending dispensing for ${instructions.length} signal(s) whose prescription is still pending`,
        // Repurposed, not misused: same reasoning every prior CDSS
        // planner in this codebase documents for its own
        // `modelVersion`/`promptVersion` — this planner has no model and
        // no prompt at all.
        modelVersion: 'cdss-pharmacy-dispense-rule-engine-v1',
        promptVersion: 'pharmacy-dispense-ruleset-v1',
      });
    },
  };
}
