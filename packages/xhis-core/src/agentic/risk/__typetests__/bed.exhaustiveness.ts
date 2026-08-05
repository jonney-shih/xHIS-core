import type { BedInstruction } from '../../../instructions/bed/types.js';
import type { RiskTierRegistry } from '../tiers.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `bedRiskTiers` is total over
 * `BedInstruction`: omitting a tier here must fail to compile.
 */
const incomplete = {
  AssignBed: 'review-required',
  // @ts-expect-error - ReleaseBed intentionally omitted to prove the registry is total
} satisfies RiskTierRegistry<BedInstruction>;

void incomplete;
