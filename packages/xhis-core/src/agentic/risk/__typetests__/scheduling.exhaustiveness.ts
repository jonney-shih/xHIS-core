import type { SchedulingInstruction } from '../../../instructions/scheduling/types.js';
import type { RiskTierRegistry } from '../tiers.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `schedulingRiskTiers` is total over
 * `SchedulingInstruction`: omitting a tier here must fail to compile.
 */
const incomplete = {
  ScheduleBooking: 'review-required',
  // @ts-expect-error - CancelBooking intentionally omitted to prove the registry is total
} satisfies RiskTierRegistry<SchedulingInstruction>;

void incomplete;
