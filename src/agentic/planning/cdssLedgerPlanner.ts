import { ok, type Result } from '../../core/execution/result.js';
import type { EntryId } from '../../instructions/ledger/ids.js';
import type { LedgerContext } from '../../instructions/ledger/types.js';
import type { PlanningGoal } from './proposal.js';
import type { RawPlanner, RawPlanOutput } from './toPlanProposal.js';

/**
 * A structured "this posted entry is flagged for reversal" signal — the
 * ledger-domain counterpart to `cdssPharmacyPlanner.ts`'s
 * `PharmacyDispenseReadySignal`, sharing its exact reasoning. Carries
 * `entryId` directly, not an encounter or other lookup key: like
 * dispensing, reversing a specific, already-posted entry has nothing
 * left to select or look up — the target is already named. The one
 * thing this rule still must not do is recommend *posting* anything:
 * `PostEntry` needs real financial content (which accounts, which
 * amounts) this codebase has no authority to invent, the same
 * restraint `cdssLabPlanner.ts`'s and `cdssPharmacyPlanner.ts`'s own
 * doc comments already apply to `OrderLabTest` and `PrescribeMedication`
 * respectively. Reversing an already-posted entry needs no such
 * invention — only confirming it's still `'posted'`.
 */
export interface LedgerReversalReadySignal {
  readonly entryId: EntryId;
}

/** Same "bundle what informs planning, not ambient state" reasoning
 * every prior CDSS context type in this codebase already gives. */
export interface CdssLedgerContext {
  readonly ledgerContext: LedgerContext;
  readonly signals: readonly LedgerReversalReadySignal[];
}

/**
 * The sixth real domain to get a CDSS rule implementing the untrusted
 * `RawPlanner<TCtx>` contract, after patient, bed, lab, pharmacy, and
 * scheduling. Like pharmacy, ledger has no existing choreography
 * reaction at all — there is no `patientToLedger.ts` — so this is
 * ledger's first automated path to any instruction, not a third one
 * coexisting alongside an existing immediate reaction.
 *
 * The rule: for every signal whose named entry is still `'posted'` (not
 * yet reversed) in `context.ledgerContext`, recommend `ReverseEntry`. A
 * signal naming an unknown `entryId`, or one already `'reversed'`, is
 * skipped — the same idempotency discipline every prior CDSS rule in
 * this codebase applies to its own already-resolved case. An `entryId`
 * signaled more than once in the same batch is recommended at most
 * once, for the identical reason `createCdssPharmacyPlanner`'s own doc
 * comment gives for `prescriptionId`: two `ReverseEntry` instructions
 * for the same `entryId` in one proposal would doom the whole batch at
 * Do time under `executeSequence`'s all-or-nothing contract, not merely
 * waste a recommendation.
 *
 * `ReverseEntry` is `'approval-required'`, ledger's own top tier,
 * `finance-controller`-only (see `risk/ledger.ts`) — the third CDSS
 * recommendation in this codebase to land at a top tier, after
 * pharmacy's `DispenseMedication` and scheduling's `CancelBooking`. Its
 * approval policy is `EXAMPLE_ledgerApprovalPolicy`'s nested,
 * subset shape (`finance-controller` alone out of `[billing-clerk,
 * finance-controller]`) — the same shape pharmacy's policy has, not
 * scheduling's disjoint one, so a `billing-clerk` fails to approve for
 * the identical "one tier too low inside a shared hierarchy" reason a
 * physician fails to approve pharmacy's `DispenseMedication`, not
 * scheduling's "unrelated role entirely" reason.
 */
export function createCdssLedgerPlanner(): RawPlanner<CdssLedgerContext> {
  return {
    async plan(
      _goal: PlanningGoal,
      context: CdssLedgerContext,
      proposedAt: string,
      _feedback: readonly string[],
    ): Promise<Result<RawPlanOutput, string>> {
      const alreadyRecommended = new Set<string>();
      const instructions: unknown[] = [];

      for (const signal of context.signals) {
        const entryIdKey = signal.entryId as string;

        if (alreadyRecommended.has(entryIdKey)) {
          continue;
        }

        const entry = context.ledgerContext.entries[entryIdKey];

        if (!entry || entry.status !== 'posted') {
          continue;
        }

        alreadyRecommended.add(entryIdKey);
        instructions.push({
          kind: 'ReverseEntry',
          entryId: signal.entryId,
          reversedAt: proposedAt,
        });
      }

      return ok({
        instructions,
        rationale: `CDSS ledger rule: recommending reversal for ${instructions.length} signal(s) whose entry is still posted`,
        // Repurposed, not misused: same reasoning every prior CDSS
        // planner in this codebase documents for its own
        // `modelVersion`/`promptVersion` — this planner has no model and
        // no prompt at all.
        modelVersion: 'cdss-ledger-reversal-rule-engine-v1',
        promptVersion: 'ledger-reversal-ruleset-v1',
      });
    },
  };
}
