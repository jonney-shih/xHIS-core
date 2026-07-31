import type { PharmacyInstruction } from '../../../instructions/pharmacy/types.js';
import type { RiskTierRegistry } from '../tiers.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `pharmacyRiskTiers` is total over
 * `PharmacyInstruction`: omitting a tier here must fail to compile.
 */
const incomplete = {
  PrescribeMedication: 'review-required',
  // @ts-expect-error - DispenseMedication intentionally omitted to prove the registry is total
} satisfies RiskTierRegistry<PharmacyInstruction>;

void incomplete;
