import type { SandboxId } from '../instructions/ids.js';

export interface SandboxStatus {
  readonly sandboxId: SandboxId;
  readonly state: 'ready' | 'reprovisioning' | 'unknown';
}

/**
 * The seam a real, K8s-backed sandbox provisioner gets swapped in
 * behind later — see `docs/XGUARD_INTEGRATION.md`'s "deferred" section.
 * `agentic/shell/opsShell.ts`'s `OpsShell.commit()` is the only caller
 * that ever invokes this interface; nothing else in this package
 * depends on which implementation is behind it, the same seam role
 * `@xhis/core`'s `ImperativeShell` itself plays one layer up.
 *
 * // TODO: real K8s-backed implementation. `@kubernetes/client-node`
 * is now a dependency of this package — see `cluster/kubernetes*.ts`
 * for the real `NodeCordoner`/`ContainerRestarter`/`DeploymentScaler`
 * built against it — but a real `SandboxProvisioner` isn't among them
 * yet; "reprovision a sandbox" has no settled K8s-resource shape in
 * this workspace the way "cordon a node"/"delete a pod"/"scale a
 * deployment" already do, so building one here would mean guessing at
 * that shape instead of waiting on a real, stated need, the same
 * discipline this codebase's own history already favors (see
 * `docs/DETERMINISTIC_CORE_PATTERN.md`). This package's own
 * responsibilities would also grow to include an idle-TTL reaper
 * (sandboxes nobody is reprovisioning or actively using get torn down
 * after some inactivity window) and resource-limit enforcement (a cap
 * on concurrently-provisioned sandboxes, or per-sandbox CPU/memory
 * quotas) — neither of which exists anywhere in this package today.
 * Both are explicitly out of scope for this slice; see `getStatus`'s
 * own doc comment below for exactly where the first of those would
 * plug in.
 */
export interface SandboxProvisioner {
  /** Requests that the given sandbox be torn down and replaced with a
   * fresh one. Fire-and-forget from this interface's point of view —
   * whether/when the replacement becomes `'ready'` is observed later via
   * `getStatus`, not returned here. */
  reprovision(sandboxId: SandboxId): void;
  /**
   * The provisioner's own view of a sandbox's state — `'unknown'` for a
   * `sandboxId` it has never heard of, not an error; a K8s-backed
   * implementation would derive this from real pod/cluster state. This
   * is also where an idle-TTL reaper would need to read "how long has
   * this sandbox been `'ready'` with no activity" from, once one exists
   * — not modeled here yet (see this interface's own doc comment).
   */
  getStatus(sandboxId: SandboxId): SandboxStatus;
}
