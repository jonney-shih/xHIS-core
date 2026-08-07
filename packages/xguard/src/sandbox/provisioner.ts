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
 * // TODO: real K8s-backed implementation. A real provisioner behind
 * this interface would talk to `@kubernetes/client-node` (deliberately
 * not a dependency of this package yet), and this package's own
 * responsibilities would grow to include an idle-TTL reaper (sandboxes
 * nobody is reprovisioning or actively using get torn down after some
 * inactivity window) and resource-limit enforcement (a cap on
 * concurrently-provisioned sandboxes, or per-sandbox CPU/memory quotas)
 * — neither of which exists anywhere in this package today. Both are
 * explicitly out of scope for this slice; see `getStatus`'s own doc
 * comment below for exactly where the first of those would plug in.
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
