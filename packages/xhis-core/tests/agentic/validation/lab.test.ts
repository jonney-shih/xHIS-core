import { describe, expect, it } from 'vitest';
import { validateInstruction } from '../../../src/agentic/validation/validator.js';
import { labInstructionValidators } from '../../../src/agentic/validation/lab.js';

describe('labInstructionValidators', () => {
  it('accepts a well-formed OrderLabTest candidate and brands its fields', () => {
    const result = validateInstruction(labInstructionValidators, {
      kind: 'OrderLabTest',
      orderId: 'order-1',
      encounterId: 'encounter-1',
      testCode: 'CBC',
      orderedAt: '2026-07-22T00:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'OrderLabTest',
        orderId: 'order-1',
        encounterId: 'encounter-1',
        testCode: 'CBC',
        orderedAt: '2026-07-22T00:00:00.000Z',
      },
    });
  });

  it('accepts a well-formed ReportLabResult candidate', () => {
    const result = validateInstruction(labInstructionValidators, {
      kind: 'ReportLabResult',
      orderId: 'order-1',
      result: 'WBC 7.2',
      resultedAt: '2026-07-22T01:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: 'ReportLabResult', orderId: 'order-1', result: 'WBC 7.2', resultedAt: '2026-07-22T01:00:00.000Z' },
    });
  });

  it('accepts a well-formed CancelLabOrder candidate', () => {
    const result = validateInstruction(labInstructionValidators, {
      kind: 'CancelLabOrder',
      orderId: 'order-1',
      cancelledAt: '2026-07-22T02:00:00.000Z',
    });

    expect(result).toEqual({
      ok: true,
      value: { kind: 'CancelLabOrder', orderId: 'order-1', cancelledAt: '2026-07-22T02:00:00.000Z' },
    });
  });

  it('rejects a candidate missing required fields, reporting every issue', () => {
    const result = validateInstruction(labInstructionValidators, {
      kind: 'OrderLabTest',
      orderId: '',
    });

    expect(result).toEqual({
      ok: false,
      error: [
        "'orderId' must be a non-empty string",
        "'encounterId' must be a non-empty string",
        "'testCode' must be a non-empty string",
        "'orderedAt' must be an ISO-8601 timestamp string",
      ],
    });
  });

  it('rejects a timestamp that is not ISO-8601 shaped', () => {
    const result = validateInstruction(labInstructionValidators, {
      kind: 'CancelLabOrder',
      orderId: 'order-1',
      cancelledAt: 'yesterday',
    });

    expect(result).toEqual({ ok: false, error: ["'cancelledAt' must be an ISO-8601 timestamp string"] });
  });

  it('rejects an unknown instruction kind', () => {
    const result = validateInstruction(labInstructionValidators, { kind: 'AmendLabResult', orderId: 'order-1' });

    expect(result).toEqual({ ok: false, error: ["unknown instruction kind 'AmendLabResult'"] });
  });
});
