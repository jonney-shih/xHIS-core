import type { ImagingInstruction } from '../../../instructions/imaging/types.js';
import type { RiskTierRegistry } from '../tiers.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `imagingRiskTiers` is total over
 * `ImagingInstruction`: omitting a tier here must fail to compile.
 */
const incomplete = {
  OrderStudy: 'review-required',
  RecordStudyStored: 'review-required',
  ReportStudy: 'approval-required',
  // @ts-expect-error - CancelStudy intentionally omitted to prove the registry is total
} satisfies RiskTierRegistry<ImagingInstruction>;

void incomplete;
