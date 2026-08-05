import { describe, expect, it } from 'vitest';
import { isCredentialValidAsOf } from '../../../src/instructions/nursing/credentialValidity.js';
import { nursingEngine } from '../../../src/instructions/nursing/engine.js';
import { credentialId, isoTimestamp, roleGrantId, staffId } from '../../../src/instructions/nursing/ids.js';
import type { CredentialRecord, NursingContext, NursingInstruction } from '../../../src/instructions/nursing/types.js';

/**
 * The domain-specific invariant proof step (see
 * docs/DETERMINISTIC_CORE_PATTERN.md): every role grant that exists must
 * have been backed, at the moment it was granted, by a credential that
 * belonged to the same staff member and was neither revoked nor expired
 * yet. This independently re-derives that using `isCredentialValidAsOf`
 * (which recomputes from the credential's own write-once fields) rather
 * than calling `grantRoleHandler`'s own check again — the same
 * "recompute from accumulated state, don't re-run the handler" shape
 * `ledger`'s conservation guard and `scheduling`'s feasibility guard
 * already use. `isCredentialValidAsOf` is shared with
 * `agentic/identity/nursingIdentityProvider.ts` (the real, load-bearing
 * use of the same check), not reimplemented here — this test exercises
 * it, it doesn't duplicate it.
 */

/** A small deterministic linear-congruential generator — not
 * `Math.random()`, so a failing run is exactly reproducible from the
 * fixed seed below. */
function makeRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** Strictly increasing with `step`, so timestamp *value* order always
 * matches instruction *sequence* order in this generator — avoiding a
 * spurious divergence between this test's value-based independent
 * check and `grantRoleHandler`'s partly sequence-based one (whether a
 * credential has already been revoked *by this point in the run*). */
function t(step: number) {
  const month = 1 + Math.floor(step / 28);
  const day = 1 + (step % 28);
  return isoTimestamp(`2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00.000Z`);
}

const STAFF_POOL = ['nurse-1', 'nurse-2', 'nurse-3'].map((id) => staffId(id));

describe('nursing credential/role-grant validity invariant', () => {
  it('never leaves behind a role grant whose backing credential was invalid at the moment it was granted', () => {
    const rng = makeRng(11);
    let context: NursingContext = { credentials: {}, roleGrants: {} };
    const credentialIds: string[] = [];
    let granted = 0;
    let rejectedForInvalidCredential = 0;

    for (let step = 0; step < 100; step += 1) {
      const timestamp = t(step);
      const action = rng();

      let instruction: NursingInstruction;

      if (action < 0.3 || credentialIds.length === 0) {
        const id = `cred-${step}`;
        credentialIds.push(id);
        const validityDays = 1 + Math.floor(rng() * 6); // short-lived on purpose, so expiry is actually exercised
        instruction = {
          kind: 'IssueCredential',
          credentialId: credentialId(id),
          staffId: pick(rng, STAFF_POOL),
          credentialType: 'ACLS',
          issuedAt: timestamp,
          expiresAt: t(step + validityDays),
        };
      } else if (action < 0.45) {
        instruction = { kind: 'RevokeCredential', credentialId: credentialId(pick(rng, credentialIds)), revokedAt: timestamp };
      } else {
        const referencedCredentialId = credentialId(pick(rng, credentialIds));
        const referencedCredential = context.credentials[referencedCredentialId];
        // Sometimes grant to whoever the credential actually belongs to,
        // sometimes to a random staff member — deliberately exercising
        // the staff-mismatch path too.
        const grantee = rng() < 0.7 && referencedCredential ? referencedCredential.staffId : pick(rng, STAFF_POOL);

        instruction = {
          kind: 'GrantRole',
          grantId: roleGrantId(`grant-${step}`),
          staffId: grantee,
          role: 'charge-nurse',
          credentialId: referencedCredentialId,
          grantedAt: timestamp,
        };
      }

      const result = nursingEngine.execute(context, instruction);

      if (result.ok) {
        context = result.value.context;
        if (instruction.kind === 'GrantRole') granted += 1;
      } else if (instruction.kind === 'GrantRole') {
        rejectedForInvalidCredential += 1;
      }
    }

    // Confirm the generator actually exercised rejection, not just the
    // happy path — a run with zero rejections would only prove
    // `grantRoleHandler` accepts valid grants, not that it blocks
    // invalid ones.
    expect(granted).toBeGreaterThan(0);
    expect(rejectedForInvalidCredential).toBeGreaterThan(0);

    for (const grant of Object.values(context.roleGrants)) {
      const credential = context.credentials[grant.credentialId];
      expect(credential).toBeDefined();
      expect(credential!.staffId).toBe(grant.staffId);
      expect(isCredentialValidAsOf(credential!, grant.grantedAt)).toBe(true);
    }
  });

  it('confirms the check is load-bearing: a state that skipped it is exactly a grant backed by an invalid credential', () => {
    // Not a call through `grantRoleHandler` (which correctly rejects
    // this) — a direct, deliberately-invalid context standing in for
    // "what if the validity check above were ever removed or bypassed."
    const expiredCredential: CredentialRecord = {
      credentialId: credentialId('cred-1'),
      staffId: staffId('nurse-1'),
      credentialType: 'ACLS',
      status: 'active',
      issuedAt: isoTimestamp('2026-01-01T00:00:00.000Z'),
      expiresAt: isoTimestamp('2026-02-01T00:00:00.000Z'),
    };

    expect(isCredentialValidAsOf(expiredCredential, '2026-06-01T00:00:00.000Z')).toBe(false);
  });
});
