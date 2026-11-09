import type { Identity, IdentityProvider } from '@xhis/core';
import type { DirectoryClient } from './directoryClient.js';
import { mapGroupsToRoles, type GroupToRoleMap } from './roleMapping.js';

export interface LdapIdentityProviderOptions {
  readonly client: DirectoryClient;
  readonly groupToRole: GroupToRoleMap;
  /**
   * How long a refreshed snapshot is trusted before `resolve()` fails
   * closed instead of serving it — see this file's own doc comment on
   * why staleness is a hard cutoff, not a background concern.
   */
  readonly maxCacheAgeMs: number;
}

export interface LdapIdentityProvider extends IdentityProvider {
  /**
   * The one real network call this provider ever makes: a full
   * bind + search against the directory (via `DirectoryClient`),
   * replacing the entire cached snapshot. `now` is the moment this
   * refresh is considered to have happened — caller-supplied, not an
   * ambient clock read, the same discipline `@xhis/core`'s own
   * `IsoTimestamp` convention uses (this package isn't subject to
   * `determinism.guard.test.ts`, which only scans `core/execution` and
   * `instructions`, but there's no reason to abandon the discipline
   * just because the guard doesn't reach here).
   *
   * Never called from inside `resolve()` — a real deployment calls
   * this on a timer (e.g. every few minutes) or before rendering an
   * approval UI, and accepts that `resolve()` answers against
   * whatever snapshot resulted from the most recent call, not a live
   * directory read. Rationale for choosing "refreshable cache with a
   * synchronous read" over "make `resolve()` itself hit the directory
   * every time": `IdentityProvider.resolve()` is a synchronous method
   * called directly, and transitively through `resolveApproval`/
   * `resolveApprovalForProposal`/`resolveActorForInstructions`, from
   * every clinical domain's approval-flow tests and every real
   * approval call site in this codebase — dozens of places, none of
   * which await it today. Making directory resolution itself async
   * would mean widening `IdentityProvider.resolve()`'s own signature
   * (and both of those wrapper functions') to return a `Promise`,
   * which — unlike `ImperativeShell`'s own async widening (see
   * `@xhis/core`'s `shell.ts`, where `act()`/`actHuman()` are the
   * *only* callers, so every pre-existing synchronous shell kept
   * compiling unchanged) — would force `await` onto every one of
   * those call sites, purely to accommodate one new provider most of
   * them will never use. A cache is also exactly what a real
   * deployment wants anyway: a live LDAP round trip on every single
   * approval resolution has latency, rate-limit, and
   * directory-server-load costs a local, periodically-refreshed
   * snapshot avoids — the same tradeoff
   * `docs/XGUARD_INTEGRATION.md`'s own "Checked, and explicitly
   * deferred" section already named before this package existed.
   */
  refresh(now: string): Promise<void>;
}

/**
 * A real, LDAP/Active-Directory-backed `IdentityProvider` — closing
 * the Phase 0 gap `docs/XGUARD_INTEGRATION.md`'s identity section
 * named: `EXAMPLE_opsApprovalPolicy` plus `createInMemoryIdentityProvider`
 * is "the deliberate, documented stand-in... until a real on-call
 * system exists to read from." A directory is exactly that real
 * system for role-holding staff identity (distinct from an on-call
 * *roster*, which this still doesn't model — see that section's own
 * doc comment for the difference).
 *
 * `resolve()` fails closed — returns `undefined`, the same "unknown
 * identity" outcome `resolveApproval.ts` already treats as
 * non-exceptional — in two cases: nothing has been fetched yet
 * (`refresh()` was never called), or the last fetch is older than
 * `maxCacheAgeMs` relative to `asOf`. The second case is the one a
 * naive cache wouldn't have: without it, a directory outage or a
 * forgotten refresh schedule would silently keep authorizing against
 * an arbitrarily old snapshot — a revoked role would stay effective
 * forever. Failing closed instead means a stale cache turns into
 * "nobody can get approved" rather than "everybody keeps whatever
 * access they had whenever this last happened to run" — the same
 * "empty `requiredRoles` fails closed, never open" precedent
 * `resolveApproval.ts`'s own doc comment already established for a
 * different gap.
 */
export function createLdapIdentityProvider(options: LdapIdentityProviderOptions): LdapIdentityProvider {
  let cache = new Map<string, Identity>();
  let lastRefreshedAt: string | undefined;

  return {
    async refresh(now) {
      const entries = await options.client.fetchAllEntries();
      const next = new Map<string, Identity>();
      for (const entry of entries) {
        next.set(entry.id, {
          id: entry.id,
          displayName: entry.displayName,
          roles: mapGroupsToRoles(entry.groupDns, options.groupToRole),
        });
      }
      cache = next;
      lastRefreshedAt = now;
    },

    resolve(identityId, asOf) {
      if (lastRefreshedAt === undefined) {
        return undefined;
      }
      const asOfMs = Date.parse(asOf);
      const lastRefreshedAtMs = Date.parse(lastRefreshedAt);
      // A malformed timestamp on either side fails closed the same way
      // staleness does, rather than `NaN`'s comparison-always-false
      // behavior silently treating it as fresh.
      if (Number.isNaN(asOfMs) || Number.isNaN(lastRefreshedAtMs)) {
        return undefined;
      }
      if (asOfMs - lastRefreshedAtMs > options.maxCacheAgeMs) {
        return undefined;
      }
      return cache.get(identityId);
    },
  };
}
