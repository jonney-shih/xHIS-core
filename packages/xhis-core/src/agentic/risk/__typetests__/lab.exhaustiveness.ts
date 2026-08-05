import type { LabInstruction } from '../../../instructions/lab/types.js';
import type { RiskTierRegistry } from '../tiers.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `labRiskTiers` is total over
 * `LabInstruction`: omitting a tier here must fail to compile.
 */
const incomplete = {
  OrderLabTest: 'review-required',
  ReportLabResult: 'approval-required',
  // @ts-expect-error - CancelLabOrder intentionally omitted to prove the registry is total
} satisfies RiskTierRegistry<LabInstruction>;

void incomplete;
