import type { InpatientInstruction } from '../../../instructions/inpatient/types.js';
import type { RiskTierRegistry } from '../tiers.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `inpatientRiskTiers` is total over
 * `InpatientInstruction`: omitting a tier here must fail to compile.
 */
const incomplete = {
  AssignWard: 'review-required',
  RecordProgressNote: 'review-required',
  FinalizeProgressNote: 'approval-required',
  // @ts-expect-error - TransferWard intentionally omitted to prove the registry is total
} satisfies RiskTierRegistry<InpatientInstruction>;

void incomplete;
