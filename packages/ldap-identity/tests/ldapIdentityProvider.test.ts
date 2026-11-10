import { describe, expect, it } from 'vitest';
import type { DirectoryClient, DirectoryEntry } from '../src/directoryClient.js';
import { createLdapIdentityProvider } from '../src/ldapIdentityProvider.js';

function fakeDirectoryClient(entries: readonly DirectoryEntry[]): DirectoryClient & { calls: number } {
  const client = {
    calls: 0,
    async fetchAllEntries() {
      client.calls += 1;
      return entries;
    },
  };
  return client;
}

const GROUP_TO_ROLE = {
  'CN=Attendings,DC=hospital,DC=local': 'attending-physician',
};

describe('createLdapIdentityProvider', () => {
  it('resolve() returns undefined before refresh() has ever been called -- no snapshot exists yet', () => {
    const provider = createLdapIdentityProvider({
      client: fakeDirectoryClient([]),
      groupToRole: GROUP_TO_ROLE,
      maxCacheAgeMs: 60_000,
    });

    expect(provider.resolve('dr-lee', '2026-08-01T00:00:00.000Z')).toBeUndefined();
  });

  it('resolve() answers from the cached snapshot after refresh(), with roles mapped from groupDns', async () => {
    const provider = createLdapIdentityProvider({
      client: fakeDirectoryClient([
        { id: 'dr-lee', displayName: 'Dr. Lee', groupDns: ['CN=Attendings,DC=hospital,DC=local'] },
      ]),
      groupToRole: GROUP_TO_ROLE,
      maxCacheAgeMs: 60_000,
    });

    await provider.refresh('2026-08-01T00:00:00.000Z');

    expect(provider.resolve('dr-lee', '2026-08-01T00:00:30.000Z')).toEqual({
      id: 'dr-lee',
      displayName: 'Dr. Lee',
      roles: ['attending-physician'],
    });
  });

  it('resolve() returns undefined for an identityId the directory has never reported -- the same "unknown identity" outcome every other provider gives', async () => {
    const provider = createLdapIdentityProvider({
      client: fakeDirectoryClient([{ id: 'dr-lee', displayName: 'Dr. Lee', groupDns: [] }]),
      groupToRole: GROUP_TO_ROLE,
      maxCacheAgeMs: 60_000,
    });

    await provider.refresh('2026-08-01T00:00:00.000Z');

    expect(provider.resolve('someone-who-does-not-exist', '2026-08-01T00:00:30.000Z')).toBeUndefined();
  });

  it('resolve() fails closed once the snapshot is older than maxCacheAgeMs, rather than serving stale authorization data', async () => {
    const provider = createLdapIdentityProvider({
      client: fakeDirectoryClient([
        { id: 'dr-lee', displayName: 'Dr. Lee', groupDns: ['CN=Attendings,DC=hospital,DC=local'] },
      ]),
      groupToRole: GROUP_TO_ROLE,
      maxCacheAgeMs: 60_000,
    });

    await provider.refresh('2026-08-01T00:00:00.000Z');

    // Just inside the window: still resolves.
    expect(provider.resolve('dr-lee', '2026-08-01T00:00:59.999Z')).toBeDefined();
    // Past it: fails closed.
    expect(provider.resolve('dr-lee', '2026-08-01T00:01:00.001Z')).toBeUndefined();
  });

  it('resolve() fails closed on a malformed asOf rather than treating it as fresh', async () => {
    const provider = createLdapIdentityProvider({
      client: fakeDirectoryClient([{ id: 'dr-lee', displayName: 'Dr. Lee', groupDns: [] }]),
      groupToRole: GROUP_TO_ROLE,
      maxCacheAgeMs: 60_000,
    });

    await provider.refresh('2026-08-01T00:00:00.000Z');

    expect(provider.resolve('dr-lee', 'not-a-real-timestamp')).toBeUndefined();
  });

  it('refresh() replaces the entire snapshot rather than merging into the old one', async () => {
    const client = fakeDirectoryClient([{ id: 'dr-lee', displayName: 'Dr. Lee', groupDns: [] }]);
    const provider = createLdapIdentityProvider({ client, groupToRole: GROUP_TO_ROLE, maxCacheAgeMs: 60_000 });

    await provider.refresh('2026-08-01T00:00:00.000Z');
    expect(provider.resolve('dr-lee', '2026-08-01T00:00:01.000Z')).toBeDefined();

    // A second refresh reports a directory with dr-lee removed (e.g.
    // offboarded) -- the stale entry must not survive.
    client.fetchAllEntries = async () => [];
    await provider.refresh('2026-08-01T00:05:00.000Z');

    expect(provider.resolve('dr-lee', '2026-08-01T00:05:01.000Z')).toBeUndefined();
  });

  it('resolve() never triggers a directory fetch itself -- only refresh() does', async () => {
    const client = fakeDirectoryClient([{ id: 'dr-lee', displayName: 'Dr. Lee', groupDns: [] }]);
    const provider = createLdapIdentityProvider({ client, groupToRole: GROUP_TO_ROLE, maxCacheAgeMs: 60_000 });

    provider.resolve('dr-lee', '2026-08-01T00:00:00.000Z');
    provider.resolve('dr-lee', '2026-08-01T00:00:01.000Z');
    expect(client.calls).toBe(0);

    await provider.refresh('2026-08-01T00:00:02.000Z');
    expect(client.calls).toBe(1);

    provider.resolve('dr-lee', '2026-08-01T00:00:03.000Z');
    expect(client.calls).toBe(1);
  });
});
