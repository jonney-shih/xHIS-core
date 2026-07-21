import type { LedgerInstruction } from '../../instructions/ledger/types.js';
import type { RiskTierRegistry } from './tiers.js';

/**
 * The third domain (after `lab`, `bed`) to get real agentic-layer
 * integration, continuing to close the gap
 * `docs/DETERMINISTIC_CORE_PATTERN.md` flagged.
 *
 * Ledger's own instruction set supplies its own reason to split tiers,
 * independent of patient's or lab's: `PostEntry` has a direct in-domain
 * undo — `ReverseEntry` — so a wrong posting is correctable the same
 * way `AdmitPatient` and `OrderLabTest` are, and gets `'review-required'`.
 * `ReverseEntry` has no such undo: there is no `UnreverseEntry`
 * instruction, and an `EntryRecord` once `reversed` never goes back to
 * `posted` (see `types.ts`'s doc comment on immutability). Fixing a
 * wrongful reversal means posting a brand new corrective entry, not
 * undoing the reversal itself — the same "terminal within this domain"
 * shape `DischargePatient` and `ReportLabResult` earn their own top tier
 * for, arrived at here from ledger's own instruction set having no
 * inverse for it, not copied from either. Any new `LedgerInstruction`
 * variant added without a tier here fails to compile; see
 * `__typetests__/ledger.exhaustiveness.ts` for the proof.
 */
export const ledgerRiskTiers = {
  PostEntry: 'review-required',
  ReverseEntry: 'approval-required',
} satisfies RiskTierRegistry<LedgerInstruction>;
