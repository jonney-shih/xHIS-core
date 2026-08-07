import type { SandboxId } from '../instructions/ids.js';
import type { SandboxProvisioner, SandboxStatus } from './provisioner.js';

/**
 * Records reprovision requests and tracked status in memory instead of
 * talking to a real cluster — exists for tests and for exercising
 * `OpsShell`/the ops remediation pipeline end to end before a real,
 * K8s-backed `SandboxProvisioner` is built. Same role in this package
 * `@xhis/core`'s `createInMemoryShell` plays for `ImperativeShell`, and
 * the same naming convention.
 *
 * // TODO: real K8s-backed implementation — see `provisioner.ts`'s own
 * doc comment for what that would additionally need to take on (an
 * idle-TTL reaper, resource-limit enforcement), neither of which this
 * in-memory stand-in attempts.
 */
export function createInMemorySandboxProvisioner(
  initialStatuses: readonly SandboxStatus[] = [],
): SandboxProvisioner & { readonly reprovisionCalls: readonly SandboxId[] } {
  const statuses = new Map<SandboxId, SandboxStatus>(initialStatuses.map((status) => [status.sandboxId, status]));
  const reprovisionCalls: SandboxId[] = [];

  return {
    reprovisionCalls,
    reprovision(sandboxId) {
      reprovisionCalls.push(sandboxId);
      statuses.set(sandboxId, { sandboxId, state: 'reprovisioning' });
    },
    getStatus(sandboxId) {
      return statuses.get(sandboxId) ?? { sandboxId, state: 'unknown' };
    },
  };
}
