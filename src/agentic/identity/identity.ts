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
 */
export interface IdentityProvider {
  resolve(identityId: string): Identity | undefined;
}
