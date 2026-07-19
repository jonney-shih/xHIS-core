import type { Kinded } from '../../core/execution/kinded.js';
import { effectiveTier, type RiskTierRegistry } from '../risk/tiers.js';
import type { Verifier } from './verifier.js';

/**
 * The risk-tier half of Check (see docs/AGENTIC_LAYER.md) — combine with
 * `batchSizeRule.ts` / `pdpaRules.ts` via `combineVerifiers()` for the rest;
 * see `patient.ts` for the assembled example. `auto`-tier sequences are
 * accepted outright; anything else always needs human approval.
 */
export function createRiskTierVerifier<TInstruction extends Kinded>(
  registry: RiskTierRegistry<TInstruction>,
): Verifier<TInstruction> {
  return {
    verify(proposal) {
      const tier = effectiveTier(registry, proposal.instructions);

      if (tier === 'auto') {
        return { kind: 'accept' };
      }

      return {
        kind: 'needs-human-approval',
        reasons: [`sequence contains an instruction at risk tier '${tier}'`],
      };
    },
  };
}
