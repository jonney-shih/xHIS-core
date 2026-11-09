import { describe, expect, it } from 'vitest';
import { mapGroupsToRoles } from '../src/roleMapping.js';

describe('mapGroupsToRoles', () => {
  it('maps a known group DN to its role name', () => {
    const roles = mapGroupsToRoles(['CN=Attending Physicians,OU=Groups,DC=hospital,DC=local'], {
      'CN=Attending Physicians,OU=Groups,DC=hospital,DC=local': 'attending-physician',
    });
    expect(roles).toEqual(['attending-physician']);
  });

  it('silently ignores a group DN with no mapping -- not every memberOf entry is this system\'s business', () => {
    const roles = mapGroupsToRoles(['CN=Domain Users,CN=Users,DC=hospital,DC=local'], {
      'CN=Attending Physicians,OU=Groups,DC=hospital,DC=local': 'attending-physician',
    });
    expect(roles).toEqual([]);
  });

  it('deduplicates when two group DNs map to the same role', () => {
    const roles = mapGroupsToRoles(
      ['CN=Attendings-Site-A,DC=hospital,DC=local', 'CN=Attendings-Site-B,DC=hospital,DC=local'],
      {
        'CN=Attendings-Site-A,DC=hospital,DC=local': 'attending-physician',
        'CN=Attendings-Site-B,DC=hospital,DC=local': 'attending-physician',
      },
    );
    expect(roles).toEqual(['attending-physician']);
  });

  it('maps several distinct groups to several distinct roles', () => {
    const roles = mapGroupsToRoles(
      ['CN=Attendings,DC=hospital,DC=local', 'CN=ChargeNurses,DC=hospital,DC=local'],
      {
        'CN=Attendings,DC=hospital,DC=local': 'attending-physician',
        'CN=ChargeNurses,DC=hospital,DC=local': 'charge-nurse',
      },
    );
    expect(roles.sort()).toEqual(['attending-physician', 'charge-nurse']);
  });

  it('returns an empty list for an identity with no group memberships at all', () => {
    expect(mapGroupsToRoles([], { 'CN=Attendings,DC=hospital,DC=local': 'attending-physician' })).toEqual([]);
  });
});
