import type { Identity, IdentityProvider } from './identity.js';

/**
 * A fixed, in-memory directory. Exists for tests and for exercising
 * `resolveApproval` end to end before a real identity system (see
 * `IdentityProvider`'s doc comment) is wired in. Accepts `asOf` for
 * interface conformance but never reads it — a fixed list has no
 * expiry/revocation semantics at all, so there is no "as of when"
 * question for it to answer. `createNursingIdentityProvider` is the
 * counterexample: a provider for which `asOf` actually changes the
 * answer.
 */
export function createInMemoryIdentityProvider(identities: readonly Identity[]): IdentityProvider {
  const byId = new Map(identities.map((identity) => [identity.id, identity]));

  return {
    resolve(identityId, _asOf) {
      return byId.get(identityId);
    },
  };
}
