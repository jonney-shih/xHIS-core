import type { AccountId, EntryId, IsoTimestamp } from './ids.js';

/**
 * The fourth domain, and the first outside the "state/time-precision +
 * regulatory" family `patient`/`bed`/`lab` all belong to (see
 * docs/DETERMINISTIC_CORE_PATTERN.md's three-family reclassification) —
 * this one tests the **conservation** family instead: double-entry
 * bookkeeping, where the domain-specific invariant isn't "no double
 * booking" or "exact replay" but "every posted entry's debits equal its
 * credits, so the ledger's total balance never moves." See
 * `tests/instructions/ledger/conservation.guard.test.ts` for the proof.
 *
 * Amounts are integers in minor units (cents), never floats — the usual
 * reason: floating-point addition isn't associative, and a conservation
 * invariant checked with `===` needs exact arithmetic, not "close enough."
 */
export interface LedgerLine {
  readonly accountId: AccountId;
  readonly direction: 'debit' | 'credit';
  readonly amount: number;
}

/**
 * `balance` is signed: positive means net-debited, negative means
 * net-credited. Accounts aren't created by a separate instruction —
 * they come into existence the first time a posted entry references
 * them, starting from an implicit zero balance — same restraint as
 * `patient`/`bed` not inventing structure a first slice doesn't need.
 */
export interface AccountRecord {
  readonly accountId: AccountId;
  readonly balance: number;
}

export interface EntryRecord {
  readonly entryId: EntryId;
  readonly lines: readonly LedgerLine[];
  readonly memo: string;
  readonly status: 'posted' | 'reversed';
  readonly postedAt: IsoTimestamp;
  readonly reversedAt?: IsoTimestamp;
}

/** Plain, JSON-serializable state — see `PatientContext`'s doc comment
 * for why that matters. */
export interface LedgerContext {
  readonly accounts: Readonly<Record<string, AccountRecord>>;
  readonly entries: Readonly<Record<string, EntryRecord>>;
}

/**
 * Two instructions, same restraint as `patient` — no `CreateAccount`
 * (accounts auto-vivify, see `AccountRecord`'s doc comment), no partial
 * amendment of an already-posted entry (an entry is immutable once
 * posted; correcting one means reversing it and posting a new one, the
 * standard double-entry discipline for never silently rewriting history
 * TFDA/MOHW-style audit trails already care about elsewhere in this
 * codebase).
 */
export type LedgerInstruction =
  | {
      readonly kind: 'PostEntry';
      readonly entryId: EntryId;
      readonly lines: readonly LedgerLine[];
      readonly memo: string;
      readonly postedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'ReverseEntry';
      readonly entryId: EntryId;
      readonly reversedAt: IsoTimestamp;
    };

export type LedgerEffect =
  | {
      readonly kind: 'EntryPosted';
      readonly entryId: EntryId;
      readonly lines: readonly LedgerLine[];
      readonly postedAt: IsoTimestamp;
    }
  | {
      readonly kind: 'EntryReversed';
      readonly entryId: EntryId;
      readonly reversedAt: IsoTimestamp;
    };

export type LedgerError =
  | { readonly kind: 'EntryAlreadyExists'; readonly entryId: EntryId }
  | { readonly kind: 'EntryNotFound'; readonly entryId: EntryId }
  | { readonly kind: 'EntryAlreadyReversed'; readonly entryId: EntryId }
  | { readonly kind: 'EntryHasNoLines'; readonly entryId: EntryId }
  | { readonly kind: 'InvalidLineAmount'; readonly entryId: EntryId; readonly accountId: AccountId }
  | {
      readonly kind: 'EntryNotBalanced';
      readonly entryId: EntryId;
      readonly debitTotal: number;
      readonly creditTotal: number;
    };
