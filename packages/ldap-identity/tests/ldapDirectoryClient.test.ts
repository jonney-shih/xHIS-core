import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * No real Active Directory / LDAP server is available to this
 * workspace to verify `createLdapDirectoryClient` against (the LDAP
 * ecosystem's usual lightweight test-server package, `ldapjs`, is
 * itself now decommissioned — see this package's own README for why
 * it isn't a dependency here at all). Rather than stand up a
 * hand-rolled fake LDAP *wire protocol* server (a far larger
 * undertaking than `@xhis/xguard`'s fake HTTP server, since LDAP is a
 * binary, BER-encoded protocol, not JSON-over-HTTP), these tests take
 * the same approach `packages/postgres-shell`'s own unit tests take
 * for `pg.Pool` (see `tests/support/fakePgPool.ts` there): fake the
 * client library's own exported shape directly, via `vi.mock`, and
 * prove this file's logic — which bind credentials, which search
 * parameters, how a returned `Entry` gets mapped to a `DirectoryEntry`,
 * that `unbind()` always runs — without a real directory. What this
 * doesn't prove, because nothing short of a real directory can: that
 * a real Active Directory server accepts this bind, or returns
 * `memberOf` in the shape assumed here.
 */
const bindCalls: Array<{ dn: string; password: string | undefined }> = [];
const searchCalls: Array<{ baseDn: string; options: unknown }> = [];
let unbindCalls = 0;
let searchResult: { searchEntries: Record<string, unknown>[] } = { searchEntries: [] };
let bindShouldThrow: Error | undefined;

vi.mock('ldapts', () => ({
  Client: class FakeClient {
    constructor(_options: unknown) {}
    async bind(dn: string, password?: string) {
      bindCalls.push({ dn, password });
      if (bindShouldThrow) {
        throw bindShouldThrow;
      }
    }
    async search(baseDn: string, options: unknown) {
      searchCalls.push({ baseDn, options });
      return searchResult;
    }
    async unbind() {
      unbindCalls += 1;
    }
  },
}));

const { createLdapDirectoryClient } = await import('../src/ldapDirectoryClient.js');

afterEach(() => {
  bindCalls.length = 0;
  searchCalls.length = 0;
  unbindCalls = 0;
  searchResult = { searchEntries: [] };
  bindShouldThrow = undefined;
});

describe('createLdapDirectoryClient', () => {
  it('binds with the configured credentials and searches with scope sub, the configured filter and attributes', async () => {
    const client = createLdapDirectoryClient({
      url: 'ldaps://dc.hospital.local:636',
      bindDn: 'cn=svc-xhis,ou=service-accounts,dc=hospital,dc=local',
      bindPassword: 'super-secret',
      baseDn: 'ou=staff,dc=hospital,dc=local',
    });

    await client.fetchAllEntries();

    expect(bindCalls).toEqual([
      { dn: 'cn=svc-xhis,ou=service-accounts,dc=hospital,dc=local', password: 'super-secret' },
    ]);
    expect(searchCalls).toEqual([
      {
        baseDn: 'ou=staff,dc=hospital,dc=local',
        options: {
          scope: 'sub',
          filter: '(objectClass=person)',
          attributes: ['sAMAccountName', 'displayName', 'memberOf'],
        },
      },
    ]);
  });

  it('honors custom filter and attribute names instead of the Active-Directory defaults', async () => {
    const client = createLdapDirectoryClient({
      url: 'ldap://dc.hospital.local:389',
      bindDn: 'cn=svc-xhis,dc=hospital,dc=local',
      bindPassword: 'super-secret',
      baseDn: 'ou=staff,dc=hospital,dc=local',
      userFilter: '(objectClass=inetOrgPerson)',
      idAttribute: 'uid',
      displayNameAttribute: 'cn',
      groupAttribute: 'isMemberOf',
    });

    await client.fetchAllEntries();

    expect(searchCalls[0]?.options).toEqual({
      scope: 'sub',
      filter: '(objectClass=inetOrgPerson)',
      attributes: ['uid', 'cn', 'isMemberOf'],
    });
  });

  it('maps a search entry into a DirectoryEntry, normalizing a multi-valued memberOf array', async () => {
    searchResult = {
      searchEntries: [
        {
          dn: 'cn=dr-lee,ou=staff,dc=hospital,dc=local',
          sAMAccountName: 'dr-lee',
          displayName: 'Dr. Lee',
          memberOf: [
            'CN=Attendings,DC=hospital,DC=local',
            'CN=Domain Users,CN=Users,DC=hospital,DC=local',
          ],
        },
      ],
    };

    const client = createLdapDirectoryClient({
      url: 'ldaps://dc.hospital.local:636',
      bindDn: 'cn=svc-xhis,dc=hospital,dc=local',
      bindPassword: 'super-secret',
      baseDn: 'ou=staff,dc=hospital,dc=local',
    });

    const entries = await client.fetchAllEntries();

    expect(entries).toEqual([
      {
        id: 'dr-lee',
        displayName: 'Dr. Lee',
        groupDns: ['CN=Attendings,DC=hospital,DC=local', 'CN=Domain Users,CN=Users,DC=hospital,DC=local'],
      },
    ]);
  });

  it('normalizes a single-valued memberOf (a string, not an array) into a one-element groupDns list', async () => {
    searchResult = {
      searchEntries: [
        {
          dn: 'cn=dr-lee,ou=staff,dc=hospital,dc=local',
          sAMAccountName: 'dr-lee',
          displayName: 'Dr. Lee',
          memberOf: 'CN=Attendings,DC=hospital,DC=local',
        },
      ],
    };

    const client = createLdapDirectoryClient({
      url: 'ldaps://dc.hospital.local:636',
      bindDn: 'cn=svc-xhis,dc=hospital,dc=local',
      bindPassword: 'super-secret',
      baseDn: 'ou=staff,dc=hospital,dc=local',
    });

    const entries = await client.fetchAllEntries();

    expect(entries[0]?.groupDns).toEqual(['CN=Attendings,DC=hospital,DC=local']);
  });

  it('falls back to the entry dn for id/displayName when the configured attributes are missing', async () => {
    searchResult = {
      searchEntries: [{ dn: 'cn=dr-lee,ou=staff,dc=hospital,dc=local' }],
    };

    const client = createLdapDirectoryClient({
      url: 'ldaps://dc.hospital.local:636',
      bindDn: 'cn=svc-xhis,dc=hospital,dc=local',
      bindPassword: 'super-secret',
      baseDn: 'ou=staff,dc=hospital,dc=local',
    });

    const entries = await client.fetchAllEntries();

    expect(entries).toEqual([
      { id: 'cn=dr-lee,ou=staff,dc=hospital,dc=local', displayName: 'cn=dr-lee,ou=staff,dc=hospital,dc=local', groupDns: [] },
    ]);
  });

  it('always unbinds, even when bind() throws -- never leaks a connection on a failed auth attempt', async () => {
    bindShouldThrow = new Error('invalid credentials');
    const client = createLdapDirectoryClient({
      url: 'ldaps://dc.hospital.local:636',
      bindDn: 'cn=svc-xhis,dc=hospital,dc=local',
      bindPassword: 'wrong-password',
      baseDn: 'ou=staff,dc=hospital,dc=local',
    });

    await expect(client.fetchAllEntries()).rejects.toThrow('invalid credentials');
    expect(unbindCalls).toBe(1);
  });
});
