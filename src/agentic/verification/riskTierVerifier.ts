import type { Kinded } from '../../core/execution/kinded.js';
import { effectiveTier, type RiskTierRegistry } from '../risk/tiers.js';
import type { Verifier } from './verifier.js';

/**
 * Implements only the risk-tier half of Check (see docs/AGENTIC_LAYER.md).
 * No business or PDPA rules yet — this exists so the Plan -> Do -> Check ->
 * Act path can be exercised end-to-end before those rules are written.
 * `auto`-tier sequences are accepted outright; anything else always needs
 * human approval. A real Check step would run this alongside business/PDPA
 * rules and combine outcomes so risk tier can only raise the decision
 * towards requiring approval, never lower it.
 */
export function createRiskTierVerifier<TInstruction extends Kinded>(
  registry: RiskTierRegistry<TInstruction>,
): Verifier<TInstruction> {
  return {
    verify(instructions) {
      const tier = effectiveTier(registry, instructions);

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
