import { describe, expect, it } from 'vitest';
import { ledgerInstructionValidators } from '../../../src/agentic/validation/ledger.js';
import { validateInstruction } from '../../../src/agentic/validation/validator.js';

const rawLines = [
  { accountId: 'cash', direction: 'debit', amount: 500 },
  { accountId: 'revenue', direction: 'credit', amount: 500 },
];

describe('ledgerInstructionValidators', () => {
  it('accepts a well-formed PostEntry candidate and brands its fields', () => {
    const result = validateInstruction(ledgerInstructionValidators, {
      kind: 'PostEntry',
      entryId: 'entry-1',
      lines: rawLines,
      memo: 'invoice #1',
      postedAt: '2026-07-22T00:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'PostEntry',
        entryId: 'entry-1',
        lines: rawLines,
        memo: 'invoice #1',
        postedAt: '2026-07-22T00:00:00.000Z',
      },
    });
  });

  it('accepts a well-formed ReverseEntry candidate', () => {
    const result = validateInstruction(ledgerInstructionValidators, {
      kind: 'ReverseEntry',
      entryId: 'entry-1',
      reversedAt: '2026-07-22T02:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: 'ReverseEntry', entryId: 'entry-1', reversedAt: '2026-07-22T02:00:00.000Z' },
    });
  });

  it('rejects a candidate missing required fields, reporting every issue', () => {
    const result = validateInstruction(ledgerInstructionValidators, {
      kind: 'PostEntry',
      entryId: '',
    });

    expect(result).toEqual({
      ok: false,
      error: [
        "'entryId' must be a non-empty string",
        "'lines' must be a non-empty array of { accountId: non-empty string, direction: 'debit' | 'credit', amount: integer }",
        "'memo' must be a non-empty string",
        "'postedAt' must be an ISO-8601 timestamp string",
      ],
    });
  });

  it('rejects lines that are missing, empty, or malformed', () => {
    const missing = validateInstruction(ledgerInstructionValidators, {
      kind: 'PostEntry',
      entryId: 'entry-1',
      memo: 'invoice #1',
      postedAt: '2026-07-22T00:00:00.000Z',
    });
    expect(missing.ok).toBe(false);

    const empty = validateInstruction(ledgerInstructionValidators, {
      kind: 'PostEntry',
      entryId: 'entry-1',
      lines: [],
      memo: 'invoice #1',
      postedAt: '2026-07-22T00:00:00.000Z',
    });
    expect(empty.ok).toBe(false);

    const fractionalAmount = validateInstruction(ledgerInstructionValidators, {
      kind: 'PostEntry',
      entryId: 'entry-1',
      lines: [{ accountId: 'cash', direction: 'debit', amount: 5.5 }],
      memo: 'invoice #1',
      postedAt: '2026-07-22T00:00:00.000Z',
    });
    expect(fractionalAmount.ok).toBe(false);

    const badDirection = validateInstruction(ledgerInstructionValidators, {
      kind: 'PostEntry',
      entryId: 'entry-1',
      lines: [{ accountId: 'cash', direction: 'sideways', amount: 5 }],
      memo: 'invoice #1',
      postedAt: '2026-07-22T00:00:00.000Z',
    });
    expect(badDirection.ok).toBe(false);
  });

  it('rejects a timestamp that is not ISO-8601 shaped', () => {
    const result = validateInstruction(ledgerInstructionValidators, {
      kind: 'ReverseEntry',
      entryId: 'entry-1',
      reversedAt: 'yesterday',
    });

    expect(result).toEqual({ ok: false, error: ["'reversedAt' must be an ISO-8601 timestamp string"] });
  });

  it('rejects an unknown instruction kind', () => {
    const result = validateInstruction(ledgerInstructionValidators, { kind: 'AmendEntry', entryId: 'entry-1' });

    expect(result).toEqual({ ok: false, error: ["unknown instruction kind 'AmendEntry'"] });
  });
});
