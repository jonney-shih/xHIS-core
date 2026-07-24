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
 * Takes a `readNursingContext` callback, called fresh inside `resolve()`
 * every time — never cached. This used to take a frozen `NursingContext`
 * snapshot instead, and nothing stopped a caller from resolving against
 * one that had gone stale relative to nursing's real, current state
 * (e.g. a credential revoked *after* the snapshot was taken would still
 * read as active) — see
 * `tests/agentic/identity/nursingIdentityProviderStaleness.test.ts` for
 * the empirical proof this used to be a real gap, and
 * `docs/DETERMINISTIC_CORE_PATTERN.md`'s "Resolved: nursing identity
 * resolution reads fresh, not from a frozen snapshot" for what fixing
 * it required. A real caller wires this as something like
 * `() => readLatestContext(nursingCommitsFile) ?? emptyNursingContext` —
 * the same "recompute against reality at the moment that matters, don't
 * trust an earlier snapshot" move `act()`'s `reexecute` already makes
 * for commits, applied here to identity resolution instead.
 */
export function createNursingIdentityProvider(readNursingContext: () => NursingContext): IdentityProvider {
  return {
    resolve(identityId, asOf) {
      const nursingContext = readNursingContext();
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
