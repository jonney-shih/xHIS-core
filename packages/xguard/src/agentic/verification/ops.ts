import type { Kinded, Verifier } from '@xhis/core';
import { combineVerifiers, createRiskTierVerifier } from '@xhis/core';
import type { OpsInstruction } from '../../instructions/types.js';
import { opsRiskTiers } from '../../policy/riskTiers.js';

/**
 * A placeholder for real blast-radius modeling — "how many pods/nodes/
 * deployments would this actually affect" — which needs real cluster
 * state (see `sandbox/provisioner.ts`'s `// TODO: real K8s-backed
 * implementation`) this package deliberately does not have yet.
 * Accepts unconditionally today rather than pretending to enforce a
 * rule it can't yet compute; wired into `opsVerifier` below via
 * `combineVerifiers` so a future real implementation only has to change
 * this one function's body, not any caller.
 */
export function createBlastRadiusPlaceholderVerifier<TInstruction extends Kinded>(): Verifier<TInstruction> {
  return {
    verify(_proposal) {
      return { kind: 'accept' };
    },
  };
}

/**
 * Check, assembled for the ops domain — mirrors every clinical domain's
 * own `agentic/verification/*.ts` in `@xhis/core` (see `bed.ts` there):
 * risk tier first (the one real, load-bearing rule today), then the
 * blast-radius placeholder above.
 */
export const opsVerifier: Verifier<OpsInstruction> = combineVerifiers<OpsInstruction>(
  createRiskTierVerifier(opsRiskTiers),
  createBlastRadiusPlaceholderVerifier<OpsInstruction>(),
);
