import type { BedInstruction } from '../../instructions/bed/types.js';
import type { RiskTierRegistry } from './tiers.js';

/**
 * The second domain besides `patient` to get real agentic-layer
 * integration (after `lab`), continuing to close the gap
 * `docs/DETERMINISTIC_CORE_PATTERN.md` flagged.
 *
 * Unlike `lab` (where `ReportLabResult` earns its own top tier) or
 * `patient` (where `DischargePatient` does), neither `AssignBed` nor
 * `ReleaseBed` has a terminal-consequence shape: both are reversible
 * resource-allocation moves on a physical asset, not clinical facts
 * that a downstream decision gets silently built on top of. A wrong
 * `AssignBed` gets corrected by releasing and reassigning; a wrong
 * `ReleaseBed` gets corrected by assigning again. That is exactly the
 * "correctable, lower-consequence" reasoning `AdmitPatient` and lab's
 * own `OrderLabTest`/`CancelLabOrder` get `'review-required'` for — so
 * both of bed's instructions land on the same tier, not because tiers
 * were copied from another domain, but because neither one independently
 * earns anything higher. Any new `BedInstruction` variant added without
 * a tier here fails to compile; see `__typetests__/bed.exhaustiveness.ts`
 * for the proof.
 */
export const bedRiskTiers = {
  AssignBed: 'review-required',
  ReleaseBed: 'review-required',
} satisfies RiskTierRegistry<BedInstruction>;
