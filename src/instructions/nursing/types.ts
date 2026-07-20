import type { CredentialId, IsoTimestamp, RoleGrantId, StaffId } from './ids.js';

/**
 * The seventh domain — and specifically the "credential/role state" half
 * of what earlier discussion called "nursing," deliberately split from
 * its other half. Nursing was originally deferred because it conflates
 * two unrelated concerns: credential/role state (this domain) and
 * roster generation, an optimization/feasibility problem already tested
 * by `src/instructions/scheduling`. This domain covers only the first —
 * no shift assignment, no patient-to-nurse ratios, no charting. Still
 * the same "state/time-precision plus regulatory traceability" family
 * `patient`/`bed`/`lab` belong to, not a fourth family: the invariant
 * here is a *gating* relationship between two kinds of state (a role
 * grant is only valid if backed by a currently-valid credential), not a
 * new invariant *shape*.
 *
 * This also happens to be the first concrete step toward the
 * `IdentityProvider` gap `docs/AGENTIC_LAYER.md` flags —
 * `createInMemoryIdentityProvider` is a fixed snapshot with no time
 * dimension and no record of *why* an identity holds a role. Nothing
 * here wires this domain into `IdentityProvider` yet (that's a separate,
 * larger step — see `docs/DETERMINISTIC_CORE_PATTERN.md`), but a real
 * implementation could plausibly derive `Identity.roles` from this
 * domain's committed state instead of a hand-maintained list.
 */
export interface CredentialRecord {
  readonly credentialId: CredentialId;
  readonly staffId: StaffId;
  readonly credentialType: string;
  readonly status: 'active' | 'revoked';
  readonly issuedAt: IsoTimestamp;
  readonly expiresAt: IsoTimestamp;
  readonly revokedAt?: IsoTimestamp;
}

/**
 * A role grant is validated once, at grant time, and persists as a
 * historical fact even if its backing credential is later revoked or
 * expires — the same reasoning real institutional credentialing follows
 * (ongoing validity is a periodic recredentialing process, not
 * instant, automatic revocation the moment a printed expiry date
 * passes). There is deliberately no `RevokeRoleGrant` instruction here:
 * ending a grant explicitly isn't needed to test the actual claim under
 * test (credential validity gates *granting*), and adding it would be
 * scope beyond what this exercise needs — same restraint `imaging`
 * applies by having no way to cancel an ordered study.
 */
export interface RoleGrantRecord {
  readonly grantId: RoleGrantId;
  readonly staffId: StaffId;
  readonly role: string;
  readonly credentialId: CredentialId;
  readonly grantedAt: IsoTimestamp;
}

/** Plain, JSON-serializable state — see `PatientContext`'s doc comment
 * for why that matters. */
export interface NursingContext {
  readonly credentials: Readonly<Record<string, CredentialRecord>>;
  readonly roleGrants: Readonly<Record<string, RoleGrantRecord>>;
}

export type NursingInstruction =
  | {
      readonly kind: 'IssueCredential';
      readonly credentialId: CredentialId;
      readonly staffId: StaffId;
      readonly credentialType: string;
      readonly issuedAt: IsoTimestamp;
      readonly expiresAt: IsoTimestamp;
    }
  | {
      readonly kind: 'RevokeCredential';
      readonly credentialId: CredentialId;
      readonly revokedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'GrantRole';
      readonly grantId: RoleGrantId;
      readonly staffId: StaffId;
      readonly role: string;
      readonly credentialId: CredentialId;
      readonly grantedAt: IsoTimestamp;
    };

export type NursingEffect =
  | {
      readonly kind: 'CredentialIssued';
      readonly credentialId: CredentialId;
      readonly staffId: StaffId;
      readonly credentialType: string;
      readonly issuedAt: IsoTimestamp;
      readonly expiresAt: IsoTimestamp;
    }
  | {
      readonly kind: 'CredentialRevoked';
      readonly credentialId: CredentialId;
      readonly staffId: StaffId;
      readonly revokedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'RoleGranted';
      readonly grantId: RoleGrantId;
      readonly staffId: StaffId;
      readonly role: string;
      readonly credentialId: CredentialId;
      readonly grantedAt: IsoTimestamp;
    };

export type NursingError =
  | { readonly kind: 'CredentialAlreadyExists'; readonly credentialId: CredentialId }
  | { readonly kind: 'CredentialNotFound'; readonly credentialId: CredentialId }
  | { readonly kind: 'CredentialAlreadyRevoked'; readonly credentialId: CredentialId }
  | { readonly kind: 'GrantAlreadyExists'; readonly grantId: RoleGrantId }
  | { readonly kind: 'CredentialStaffMismatch'; readonly grantId: RoleGrantId; readonly credentialId: CredentialId }
  | { readonly kind: 'CredentialRevoked'; readonly grantId: RoleGrantId; readonly credentialId: CredentialId }
  | {
      readonly kind: 'CredentialExpired';
      readonly grantId: RoleGrantId;
      readonly credentialId: CredentialId;
      readonly expiresAt: IsoTimestamp;
      readonly grantedAt: IsoTimestamp;
    };
