import type { LedgerInstruction } from '../../../instructions/ledger/types.js';
import type { RiskTierRegistry } from '../tiers.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the compile-time proof that `ledgerRiskTiers` is total over
 * `LedgerInstruction`: omitting a tier here must fail to compile.
 */
const incomplete = {
  PostEntry: 'review-required',
  // @ts-expect-error - ReverseEntry intentionally omitted to prove the registry is total
} satisfies RiskTierRegistry<LedgerInstruction>;

void incomplete;
