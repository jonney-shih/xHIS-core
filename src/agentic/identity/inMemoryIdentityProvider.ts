import type { Identity, IdentityProvider } from './identity.js';

/**
 * A fixed, in-memory directory. Exists for tests and for exercising
 * `resolveApproval` end to end before a real identity system (see
 * `IdentityProvider`'s doc comment) is wired in.
 */
export function createInMemoryIdentityProvider(identities: readonly Identity[]): IdentityProvider {
  const byId = new Map(identities.map((identity) => [identity.id, identity]));

  return {
    resolve(identityId) {
      return byId.get(identityId);
    },
  };
}
