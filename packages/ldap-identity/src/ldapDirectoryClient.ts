import { Client } from 'ldapts';
import type { DirectoryClient, DirectoryEntry } from './directoryClient.js';

export interface LdapConnectionOptions {
  /** A valid LDAP URL, e.g. `ldaps://dc.hospital.local:636`. */
  readonly url: string;
  readonly bindDn: string;
  readonly bindPassword: string;
  /** The search base, e.g. `"ou=staff,dc=hospital,dc=local"`. */
  readonly baseDn: string;
  /** Default `"(objectClass=person)"`. */
  readonly userFilter?: string;
  /** The attribute holding the identifier `IdentityProvider.resolve`
   * is called with -- `"sAMAccountName"` for Active Directory,
   * `"uid"` for plain LDAP. Default `"sAMAccountName"`. */
  readonly idAttribute?: string;
  /** Default `"displayName"`. */
  readonly displayNameAttribute?: string;
  /** The multi-valued group-membership attribute, holding each
   * group's distinguished name -- `"memberOf"` for both Active
   * Directory and most plain LDAP setups with the memberOf overlay.
   * Default `"memberOf"`. */
  readonly groupAttribute?: string;
}

function toStringArray(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => String(entry));
  }
  return [String(value)];
}

function toSingleString(value: unknown, fallback: string): string {
  return toStringArray(value)[0] ?? fallback;
}

/**
 * The real, `ldapts`-backed `DirectoryClient` — the one place in this
 * package that opens a real TCP connection and speaks the LDAP wire
 * protocol. See `directoryClient.ts`'s own doc comment for why this
 * is kept behind an interface at all, and `tests/
 * ldapDirectoryClient.test.ts`'s own doc comment for what proving this
 * against a hand-rolled fake `Client`-shaped dependency does and
 * doesn't demonstrate (no real Active Directory server is available
 * to verify against — the same honestly-unverified status every other
 * real-infrastructure client in this session's work has carried, see
 * `packages/xguard/src/cluster/kubernetesNodeCordoner.ts`'s own doc
 * comment).
 *
 * A fresh bind + search + unbind on every call, deliberately: this is
 * only ever called from `ldapIdentityProvider.ts`'s `refresh()`,
 * itself invoked on a caller-controlled interval (see that file's own
 * doc comment), never from inside `resolve()` — so holding a
 * connection open between refreshes would add complexity
 * (reconnect-on-drop, rebind-on-expiry) this package has no real need
 * for yet.
 */
export function createLdapDirectoryClient(options: LdapConnectionOptions): DirectoryClient {
  const idAttribute = options.idAttribute ?? 'sAMAccountName';
  const displayNameAttribute = options.displayNameAttribute ?? 'displayName';
  const groupAttribute = options.groupAttribute ?? 'memberOf';
  const userFilter = options.userFilter ?? '(objectClass=person)';

  return {
    async fetchAllEntries(): Promise<readonly DirectoryEntry[]> {
      const client = new Client({ url: options.url });
      try {
        await client.bind(options.bindDn, options.bindPassword);
        const { searchEntries } = await client.search(options.baseDn, {
          scope: 'sub',
          filter: userFilter,
          attributes: [idAttribute, displayNameAttribute, groupAttribute],
        });

        return searchEntries.map((entry): DirectoryEntry => {
          const id = toSingleString(entry[idAttribute], entry.dn);
          return {
            id,
            displayName: toSingleString(entry[displayNameAttribute], id),
            groupDns: toStringArray(entry[groupAttribute]),
          };
        });
      } finally {
        await client.unbind();
      }
    },
  };
}
