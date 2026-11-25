/**
 * A directory group's distinguished name (e.g.
 * `"CN=Attending Physicians,OU=Groups,DC=hospital,DC=local"`), mapped
 * to this system's own role-name string (e.g. `'attending-physician'`
 * -- the same free-form strings `Identity.roles` already is in
 * `@xhis/core`, and the same ones every domain's own `EXAMPLE_*
 * ApprovalPolicy` already lists). Deliberately a per-deployment
 * configuration value, never invented here: group naming is entirely
 * a given hospital's own Active Directory structure, which this
 * package has no way to guess at and shouldn't try to.
 */
export type GroupToRoleMap = Readonly<Record<string, string>>;

/**
 * Reduces a directory entry's raw `memberOf` group DNs to this
 * system's role-name strings, via `groupToRole`. A group DN with no
 * entry in `groupToRole` is silently ignored, not an error -- a real
 * directory's `memberOf` routinely includes groups ("Domain Users",
 * distribution lists, ...) that have nothing to do with this system's
 * own authorization model, and `groupToRole` is exactly the explicit
 * allowlist that keeps those from ever becoming a role by accident.
 */
export function mapGroupsToRoles(groupDns: readonly string[], groupToRole: GroupToRoleMap): string[] {
  const roles = new Set<string>();
  for (const groupDn of groupDns) {
    const role = groupToRole[groupDn];
    if (role !== undefined) {
      roles.add(role);
    }
  }
  return [...roles];
}
