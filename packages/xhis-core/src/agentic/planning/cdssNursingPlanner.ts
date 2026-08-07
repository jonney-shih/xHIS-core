import { ok, type Result } from '../../core/execution/result.js';
import type { CredentialId } from '../../instructions/nursing/ids.js';
import type { NursingContext } from '../../instructions/nursing/types.js';
import type { PlanningGoal } from './proposal.js';
import type { RawPlanner, RawPlanOutput } from './toPlanProposal.js';

/**
 * A structured "this credential is flagged for revocation" signal — the
 * nursing-domain counterpart to `cdssPharmacyPlanner.ts`'s
 * `PharmacyDispenseReadySignal` and `cdssLedgerPlanner.ts`'s
 * `LedgerReversalReadySignal`, sharing their exact shape and reasoning.
 * Carries `credentialId` directly: revoking an already-issued credential
 * has nothing left to select or look up, the target is already named.
 *
 * Deliberately not a signal for `IssueCredential` or `GrantRole`. Nursing
 * has no choreography at all — no patient effect ever implies anything
 * about credentialing, unlike bed/lab/scheduling/imaging's discharge
 * reactions — so there is no equivalent "never implied by admission"
 * precedent to lean on here; the restraint is domain-first, not borrowed.
 * `IssueCredential` needs real content this codebase has no authority to
 * invent (which credential type, what validity window) — the same
 * restraint every prior "don't invent the primary action" CDSS decision
 * in this codebase already applies (`OrderLabTest`'s test code,
 * `PrescribeMedication`'s medication, `PostEntry`'s accounts). `GrantRole`
 * is worse than merely under-specified: it is the single instruction in
 * this entire codebase whose committed state backs *every other
 * domain's* approval authority (see `risk/nursing.ts`'s own doc
 * comment) — recommending one from a rule this simple would mean an
 * unreviewed CDSS heuristic could originate the exact permission grant
 * this whole spine exists to gate carefully. Revoking an existing
 * credential needs none of that judgment — only confirming it's still
 * `'active'`.
 */
export interface CredentialRevocationReadySignal {
  readonly credentialId: CredentialId;
}

/** Same "bundle what informs planning, not ambient state" reasoning
 * every prior CDSS context type in this codebase already gives. */
export interface CdssNursingContext {
  readonly nursingContext: NursingContext;
  readonly signals: readonly CredentialRevocationReadySignal[];
}

/**
 * The eighth, and last, domain to get a CDSS rule implementing the
 * untrusted `RawPlanner<TCtx>` contract — closing the same coverage gap
 * across every domain in this codebase that the verification-spine and
 * UI-contract wiring already closed earlier.
 *
 * The rule: for every signal whose named credential is still `'active'`
 * (not yet revoked) in `context.nursingContext`, recommend
 * `RevokeCredential`. A signal naming an unknown `credentialId`, or one
 * already `'revoked'`, is skipped — the same idempotency discipline
 * every prior CDSS rule in this codebase applies to its own
 * already-resolved case. A `credentialId` signaled more than once in
 * the same batch is recommended at most once, for the identical reason
 * `createCdssPharmacyPlanner`'s and `createCdssLedgerPlanner`'s own doc
 * comments give: two `RevokeCredential` instructions for the same
 * `credentialId` in one proposal would doom the whole batch at Do time
 * under `executeSequence`'s all-or-nothing contract.
 *
 * `RevokeCredential` is `'review-required'` (see `risk/nursing.ts`) —
 * the same lower tier `CancelLabOrder`'s and `CancelStudy`'s CDSS
 * recommendations land at, *not* `PrescribeMedication`'s/`ReverseEntry`'s
 * top tier, even though this rule shares their exact named-target,
 * dedup-guarded shape. This is the first CDSS recommendation to combine
 * that shape with the *lower* tier — pharmacy's and ledger's own
 * sections each combined it with the top one — proving the shape and
 * the tier are genuinely independent choices, not a package deal:
 * `risk/nursing.ts`'s own doc comment gives the domain-specific reason
 * `RevokeCredential` stays low-stakes despite permanently consuming the
 * `credentialId` (a role grant already made stays valid regardless — a
 * wrongful revoke is an operational nuisance, not a wrong-value-drives-
 * a-wrong-decision shape).
 */
export function createCdssNursingPlanner(): RawPlanner<CdssNursingContext> {
  return {
    async plan(
      _goal: PlanningGoal,
      context: CdssNursingContext,
      proposedAt: string,
      _feedback: readonly string[],
    ): Promise<Result<RawPlanOutput, string>> {
      const alreadyRecommended = new Set<string>();
      const instructions: unknown[] = [];

      for (const signal of context.signals) {
        const credentialIdKey = signal.credentialId as string;

        if (alreadyRecommended.has(credentialIdKey)) {
          continue;
        }

        const credential = context.nursingContext.credentials[credentialIdKey];

        if (!credential || credential.status !== 'active') {
          continue;
        }

        alreadyRecommended.add(credentialIdKey);
        instructions.push({
          kind: 'RevokeCredential',
          credentialId: signal.credentialId,
          revokedAt: proposedAt,
        });
      }

      return ok({
        instructions,
        rationale: `CDSS nursing rule: recommending revocation for ${instructions.length} signal(s) whose credential is still active`,
        // Repurposed, not misused: same reasoning every prior CDSS
        // planner in this codebase documents for its own
        // `modelVersion`/`promptVersion` — this planner has no model and
        // no prompt at all.
        modelVersion: 'cdss-nursing-revocation-rule-engine-v1',
        promptVersion: 'nursing-revocation-ruleset-v1',
      });
    },
  };
}
