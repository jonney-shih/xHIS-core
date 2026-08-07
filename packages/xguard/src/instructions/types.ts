import type { ContainerId, DeploymentId, IsoTimestamp, NodeId, SandboxId } from './ids.js';

/**
 * Ops's own PDCA instantiation of one closed instruction union, the
 * same discipline every clinical domain in `@xhis/core` already follows
 * (see `@xhis/core`'s `instructions/bed/types.ts`) — applied here to a
 * non-clinical, infrastructure-operations domain instead. `kind` stays
 * a literal string per variant; this stays a `type`, never an
 * `interface` (see `Kinded`'s own doc comment for why).
 *
 * `ReprovisionSandbox` is the one variant with a fully working path end
 * to end (see `agentic/planning/opsPlanner.ts`, `agentic/shell/opsShell.ts`,
 * and `tests/integration/sandboxTimeoutRemediation.test.ts`).
 * `CordonNode`/`RestartContainer`/`ScaleDeployment` are typed,
 * risk-tiered, and validated the same way, but have no planner rule or
 * real remediation logic behind them yet — seams for a follow-up, not
 * gaps in this slice (see docs/XGUARD_INTEGRATION.md).
 */
export type OpsInstruction =
  | {
      readonly kind: 'ReprovisionSandbox';
      readonly sandboxId: SandboxId;
      readonly requestedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'CordonNode';
      readonly nodeId: NodeId;
      readonly requestedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'RestartContainer';
      readonly containerId: ContainerId;
      readonly requestedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'ScaleDeployment';
      readonly deploymentId: DeploymentId;
      readonly replicas: number;
      readonly requestedAt: IsoTimestamp;
    };

export type OpsEffect =
  | { readonly kind: 'SandboxReprovisioned'; readonly sandboxId: SandboxId; readonly requestedAt: IsoTimestamp }
  | { readonly kind: 'NodeCordoned'; readonly nodeId: NodeId; readonly requestedAt: IsoTimestamp }
  | { readonly kind: 'ContainerRestarted'; readonly containerId: ContainerId; readonly requestedAt: IsoTimestamp }
  | {
      readonly kind: 'DeploymentScaled';
      readonly deploymentId: DeploymentId;
      readonly replicas: number;
      readonly requestedAt: IsoTimestamp;
    };

/**
 * No handler below actually returns one of these yet — every handler is
 * an unconditional `ok` (see `instructions/handlers/*.ts`), since the
 * one fully-implemented path (`ReprovisionSandbox`) has nothing in
 * `OpsContext` to conflict with. Typed now, not invented later, the
 * same "total over the union from day one" discipline `HandlerRegistry`
 * requires — a future real-K8s-backed handler that needs to reject
 * something has a variant ready to use instead of a breaking change to
 * this union.
 */
export type OpsError = { readonly kind: 'SandboxNotFound'; readonly sandboxId: SandboxId };

/**
 * Deliberately minimal, plain, JSON-serializable state — same
 * "plain data, no class instances" discipline every `@xhis/core`
 * context type follows. Only tracks sandboxes, the one domain object
 * the fully-implemented `ReprovisionSandbox` path actually needs;
 * nodes/containers/deployments have no tracked state yet, matching
 * `OpsInstruction`'s own doc comment about which variants are stubbed.
 */
export interface OpsContext {
  readonly sandboxes: Readonly<Record<string, SandboxRecord>>;
}

export interface SandboxRecord {
  readonly sandboxId: SandboxId;
  readonly status: 'ready' | 'reprovisioning';
  readonly lastRequestedAt?: IsoTimestamp;
}
