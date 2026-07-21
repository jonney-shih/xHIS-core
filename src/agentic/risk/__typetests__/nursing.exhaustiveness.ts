import type { NursingInstruction } from '../../../instructions/nursing/types.js';
import type { RiskTierRegistry } from '../tiers.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `nursingRiskTiers` is total over
 * `NursingInstruction`: omitting a tier here must fail to compile.
 */
const incomplete = {
  IssueCredential: 'review-required',
  // @ts-expect-error - RevokeCredential intentionally omitted to prove the registry is total
} satisfies RiskTierRegistry<NursingInstruction>;

void incomplete;
