/**
 * `@xhis/ldap-identity`'s public export surface — the only thing a
 * consumer (a real deployment's bootstrap code, a test) should ever
 * import from, same convention `@xhis/xguard`'s and
 * `@xhis/postgres-shell`'s own `index.ts` already follow.
 */

export type { DirectoryClient, DirectoryEntry } from './directoryClient.js';
export { createLdapDirectoryClient, type LdapConnectionOptions } from './ldapDirectoryClient.js';
export { mapGroupsToRoles, type GroupToRoleMap } from './roleMapping.js';
export {
  createLdapIdentityProvider,
  type LdapIdentityProvider,
  type LdapIdentityProviderOptions,
} from './ldapIdentityProvider.js';
