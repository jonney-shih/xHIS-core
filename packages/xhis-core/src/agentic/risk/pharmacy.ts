import type { PharmacyInstruction } from '../../instructions/pharmacy/types.js';
import type { RiskTierRegistry } from './tiers.js';

/**
 * The fourth domain besides `patient` to get real agentic-layer
 * integration (after `lab` and `bed`), continuing to close the gap
 * `docs/DETERMINISTIC_CORE_PATTERN.md` flagged.
 *
 * `PrescribeMedication` is correctable and lower-consequence — a wrong
 * prescription can still be caught and corrected before it's ever
 * dispensed, the same reasoning `AdmitPatient` and lab's own
 * `OrderLabTest` get `'review-required'` for. `DispenseMedication` is
 * `'approval-required'`: once a medication is physically dispensed it
 * may already be administered, a terminal-consequence shape directly
 * comparable to `DischargePatient`'s and lab's own `ReportLabResult`'s
 * own top tier. Any new `PharmacyInstruction` variant added without a
 * tier here fails to compile; see
 * `__typetests__/pharmacy.exhaustiveness.ts` for the proof.
 */
export const pharmacyRiskTiers = {
  PrescribeMedication: 'review-required',
  DispenseMedication: 'approval-required',
} satisfies RiskTierRegistry<PharmacyInstruction>;
