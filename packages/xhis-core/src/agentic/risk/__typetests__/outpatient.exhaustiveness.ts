import type { OutpatientInstruction } from '../../../instructions/outpatient/types.js';
import type { RiskTierRegistry } from '../tiers.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `outpatientRiskTiers` is total over
 * `OutpatientInstruction`: omitting a tier here must fail to compile.
 */
const incomplete = {
  CheckInPatient: 'review-required',
  RecordSoapNote: 'review-required',
  FinalizeSoapNote: 'approval-required',
  PlaceCpoeOrder: 'review-required',
  // @ts-expect-error - CompleteEncounter intentionally omitted to prove the registry is total
} satisfies RiskTierRegistry<OutpatientInstruction>;

void incomplete;
