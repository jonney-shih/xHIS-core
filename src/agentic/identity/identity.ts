/**
 * What's known about a resolved identity — deliberately small. `roles` is
 * a free-form string set rather than a closed union: this codebase hasn't
 * modeled a real permission taxonomy anywhere yet (same reason
 * `src/instructions/patient/**` only has two instructions — see
 * docs/ARCHITECTURE.md), and inventing one here ahead of a real need would
 * just be guessing.
 */
export interface Identity {
  readonly id: string;
  readonly displayName: string;
  readonly roles: readonly string[];
}

/**
 * The seam a real identity system (SSO, an LDAP/AD directory, a hospital
 * staff registry, ...) would implement. `resolve` returns `undefined` for
 * an ID that doesn't correspond to any known identity — deliberately not
 * an error, since "unknown identity" is an expected, non-exceptional
 * outcome that `resolveApproval.ts` has to handle either way.
 *
 * `asOf` is explicit, not ambient — the same discipline every handler in
 * this codebase already follows for time. Whether an identity still
 * holds a role is inherently a question about a specific moment (a
 * credential-backed provider needs to check expiry/revocation against
 * *some* timestamp), so this interface makes that moment a caller-
 * supplied argument rather than letting an implementation reach for
 * `Date.now()`. A time-independent provider (a fixed directory, no
 * expiry semantics at all) is free to accept and ignore it — see
 * `createInMemoryIdentityProvider`.
 */
export interface IdentityProvider {
  resolve(identityId: string, asOf: string): Identity | undefined;
}
