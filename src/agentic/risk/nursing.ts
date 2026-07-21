import type { NursingInstruction } from '../../instructions/nursing/types.js';
import type { RiskTierRegistry } from './tiers.js';

/**
 * The sixth domain (after `lab`, `bed`, `ledger`, `scheduling`,
 * `imaging`) to get real agentic-layer integration — and the last of
 * the seven, closing the gap `docs/DETERMINISTIC_CORE_PATTERN.md`
 * flagged completely.
 *
 * `IssueCredential` gets `'review-required'`: correctable via
 * `RevokeCredential`, the same "correctable, lower-consequence" shape
 * `AdmitPatient`/`OrderLabTest` get that tier for. `RevokeCredential`
 * also gets `'review-required'` — checked against `types.ts`'s own doc
 * comment: a role grant is validated *once*, at grant time, and stays
 * valid even if its backing credential is later revoked (real
 * institutional credentialing works this way; revocation isn't instant,
 * retroactive invalidation). So a wrongful revoke doesn't disturb any
 * grant already made — it only blocks *new* grants until a fresh
 * credential is issued, an operational nuisance, not the "wrong value
 * drives a wrong clinical decision" shape that would earn it the top
 * tier, even though (like `CancelBooking`/`ReverseEntry`) it
 * permanently consumes the `credentialId`.
 *
 * `GrantRole` gets `'approval-required'` for a reason no other domain's
 * top-tier instruction has: this domain's own committed state is what a
 * real `IdentityProvider` (see `identity/nursingIdentityProvider.ts`)
 * derives *every other domain's* approval authority from. A wrongful
 * `GrantRole` doesn't just misstate a fact inside nursing — it can hand
 * out the permission that gates `DischargePatient`, `ReportLabResult`,
 * `ReverseEntry`, `CancelBooking`, or `ReportStudy` across every other
 * domain in this codebase. There is also, deliberately, no
 * `RevokeRoleGrant` instruction at all (see `types.ts`), so `GrantRole`
 * is unambiguously terminal within this domain — no undo exists, not
 * even a revocation. This is the strongest-justified `'approval-
 * required'` tier of any domain so far: the blast radius of getting it
 * wrong isn't scoped to nursing's own state, it's systemic. Any new
 * `NursingInstruction` variant added without a tier here fails to
 * compile; see `__typetests__/nursing.exhaustiveness.ts` for the proof.
 */
export const nursingRiskTiers = {
  IssueCredential: 'review-required',
  RevokeCredential: 'review-required',
  GrantRole: 'approval-required',
} satisfies RiskTierRegistry<NursingInstruction>;
