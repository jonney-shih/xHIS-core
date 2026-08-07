import type { RiskTierRegistry } from '@xhis/core';
import type { OpsInstruction } from '../instructions/types.js';

/**
 * Ops's own risk classification, the same total-registry discipline
 * every clinical domain's own `agentic/risk/*.ts` follows in
 * `@xhis/core` (see `bed.ts` there for the pattern) — reusing
 * `@xhis/core`'s generic `RiskTierRegistry<TInstruction>` type rather
 * than inventing a second one.
 *
 * `ReprovisionSandbox`/`RestartContainer` are `'auto'`: replacing a
 * sandbox or restarting one container is reversible, scoped to a single
 * resource, and is exactly the kind of self-healing action an operator
 * would not want to be paged for. `ScaleDeployment` is
 * `'review-required'`: changing a deployment's replica count affects
 * every pod behind it, worth a second look but not necessarily a
 * blocking approval. `CordonNode` is `'approval-required'`: taking a
 * whole node out of the schedulable pool can affect every workload on
 * it, the highest blast radius of the four — matching the same
 * "consequence, not mechanism, drives the tier" reasoning
 * `agentic/risk/patient.ts`'s `DischargePatient` and `lab.ts`'s
 * `ReportLabResult` are given in `@xhis/core`.
 */
export const opsRiskTiers = {
  ReprovisionSandbox: 'auto',
  RestartContainer: 'auto',
  CordonNode: 'approval-required',
  ScaleDeployment: 'review-required',
} satisfies RiskTierRegistry<OpsInstruction>;
