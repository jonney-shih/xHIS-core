import type { LabInstruction } from '../../instructions/lab/types.js';
import type { RiskTierRegistry } from './tiers.js';

/**
 * The first domain besides `patient` to get real agentic-layer
 * integration — closing the gap `docs/DETERMINISTIC_CORE_PATTERN.md`
 * flagged: every risk/validation/verification/approval piece existed
 * only for `patient`, meaning no other domain (despite six existing)
 * could ever be an LLM or CDSS proposal target. `lab` is the natural
 * first choice — "should this test be ordered" is a real, CDSS-relevant
 * clinical decision, and `patientToLab.ts` already proves lab is
 * agentic-adjacent.
 *
 * `OrderLabTest`/`CancelLabOrder` are correctable and lower-consequence
 * — worst case, a test gets re-ordered, or a cancellation gets
 * reversed by ordering again — the same reasoning `AdmitPatient` gets
 * `'review-required'` for. `ReportLabResult` is `'approval-required'`:
 * a wrong committed result can directly drive a wrong clinical
 * decision downstream, the same terminal-consequence reasoning
 * `DischargePatient` gets its own top tier for. Any new `LabInstruction`
 * variant added without a tier here fails to compile; see
 * `__typetests__/lab.exhaustiveness.ts` for the proof.
 */
export const labRiskTiers = {
  OrderLabTest: 'review-required',
  ReportLabResult: 'approval-required',
  CancelLabOrder: 'review-required',
} satisfies RiskTierRegistry<LabInstruction>;
