import { isCredentialValidAsOf } from '../../instructions/nursing/credentialValidity.js';
import type { NursingContext } from '../../instructions/nursing/types.js';
import type { Identity, IdentityProvider } from './identity.js';

/**
 * Derives `Identity.roles` from `src/instructions/nursing`'s committed
 * credential/role-grant state instead of a hand-maintained list —
 * closing, for the first time, the gap `docs/AGENTIC_LAYER.md`'s open
 * questions flagged for `createInMemoryIdentityProvider`: a fixed
 * snapshot has no time dimension and no record of *why* an identity
 * holds a role.
 *
 * `identityId` is assumed to be the same identifier space as `StaffId`
 * — this provider doesn't invent an identity system, it reads one that
 * already exists as this domain's own primary key. `nursing` has no
 * notion of a display name at all, so `displayName` here is just the
 * raw ID — honest about the gap, not a real substitute for one.
 *
 * Takes a `NursingContext` snapshot, not a live handle into anything —
 * a caller re-derives a fresh provider from whatever `NursingContext`
 * is current (e.g. `readLatestContext` against nursing's own commit
 * log) rather than this module reaching for state on its own, the same
 * "no ambient state" discipline `core/execution` handlers already
 * follow.
 */
export function createNursingIdentityProvider(nursingContext: NursingContext): IdentityProvider {
  return {
    resolve(identityId, asOf) {
      const staffGrants = Object.values(nursingContext.roleGrants).filter((grant) => grant.staffId === identityId);

      // Distinct from "known, but currently holds no valid role" below
      // — this identityId has never appeared in this domain's history
      // at all, which `resolveApproval.ts` reports with a different,
      // more accurate reason ("no identity found") than "holds none of
      // the required roles."
      if (staffGrants.length === 0) {
        return undefined;
      }

      const roles = new Set<string>();
      for (const grant of staffGrants) {
        const credential = nursingContext.credentials[grant.credentialId];
        if (credential && isCredentialValidAsOf(credential, asOf)) {
          roles.add(grant.role);
        }
      }

      const identity: Identity = { id: identityId, displayName: identityId, roles: [...roles] };
      return identity;
    },
  };
}
