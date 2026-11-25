/**
 * One entry as the directory reports it -- before any of this
 * package's own interpretation (role mapping, caching, staleness)
 * happens to it. `groupDns` is the raw `memberOf` value: a list of
 * distinguished names, not yet reduced to this system's role-name
 * strings -- see `roleMapping.ts` for that step.
 */
export interface DirectoryEntry {
  readonly id: string;
  readonly displayName: string;
  readonly groupDns: readonly string[];
}

/**
 * The seam `ldapIdentityProvider.ts`'s cache refresh calls through --
 * deliberately the *only* thing in this package that talks to a real
 * directory server, so everything above it (role mapping, caching,
 * staleness, the `IdentityProvider` contract itself) can be exercised
 * and tested without one. `createLdapDirectoryClient` (see its own
 * file) is the real, `ldapts`-backed implementation; tests use a
 * hand-rolled fake directly, and `tests/ldapDirectoryClient.test.ts`
 * separately proves the real implementation's bind+search against an
 * actual (if locally-hosted, non-AD) LDAP server.
 */
export interface DirectoryClient {
  /** One full bind + search, returning every entry currently in
   * scope. Fetches everything in one pass rather than one identity at
   * a time -- see `ldapIdentityProvider.ts`'s own doc comment on why a
   * cache refresh is a single bulk operation, not a per-`resolve()`
   * lookup. */
  fetchAllEntries(): Promise<readonly DirectoryEntry[]>;
}
