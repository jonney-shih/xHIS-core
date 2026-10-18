import type { EmergencyInstruction } from '../../../instructions/emergency/types.js';
import type { RiskTierRegistry } from '../tiers.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `emergencyRiskTiers` is total over
 * `EmergencyInstruction`: omitting a tier here must fail to compile.
 */
const incomplete = {
  RegisterEdVisit: 'review-required',
  TriagePatient: 'approval-required',
  // @ts-expect-error - DispositionPatient intentionally omitted to prove the registry is total
} satisfies RiskTierRegistry<EmergencyInstruction>;

void incomplete;
