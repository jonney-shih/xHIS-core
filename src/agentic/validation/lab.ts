import { err, ok, type Result } from '../../core/execution/result.js';
import { encounterId, isoTimestamp, labOrderId } from '../../instructions/lab/ids.js';
import type { LabInstruction } from '../../instructions/lab/types.js';
import { isIsoTimestamp, isNonEmptyString } from './guards.js';
import type { InstructionValidatorRegistry } from './validator.js';

type OrderLabTest = Extract<LabInstruction, { kind: 'OrderLabTest' }>;
type ReportLabResult = Extract<LabInstruction, { kind: 'ReportLabResult' }>;
type CancelLabOrder = Extract<LabInstruction, { kind: 'CancelLabOrder' }>;

export function validateOrderLabTest(candidate: unknown): Result<OrderLabTest, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['orderId'])) issues.push("'orderId' must be a non-empty string");
  if (!isNonEmptyString(c['encounterId'])) issues.push("'encounterId' must be a non-empty string");
  if (!isNonEmptyString(c['testCode'])) issues.push("'testCode' must be a non-empty string");
  if (!isIsoTimestamp(c['orderedAt'])) issues.push("'orderedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'OrderLabTest',
    orderId: labOrderId(c['orderId'] as string),
    encounterId: encounterId(c['encounterId'] as string),
    testCode: c['testCode'] as string,
    orderedAt: isoTimestamp(c['orderedAt'] as string),
  });
}

export function validateReportLabResult(candidate: unknown): Result<ReportLabResult, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['orderId'])) issues.push("'orderId' must be a non-empty string");
  if (!isNonEmptyString(c['result'])) issues.push("'result' must be a non-empty string");
  if (!isIsoTimestamp(c['resultedAt'])) issues.push("'resultedAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'ReportLabResult',
    orderId: labOrderId(c['orderId'] as string),
    result: c['result'] as string,
    resultedAt: isoTimestamp(c['resultedAt'] as string),
  });
}

function validateCancelLabOrder(candidate: unknown): Result<CancelLabOrder, readonly string[]> {
  const c = candidate as Record<string, unknown>;
  const issues: string[] = [];

  if (!isNonEmptyString(c['orderId'])) issues.push("'orderId' must be a non-empty string");
  if (!isIsoTimestamp(c['cancelledAt'])) issues.push("'cancelledAt' must be an ISO-8601 timestamp string");

  if (issues.length > 0) {
    return err(issues);
  }

  return ok({
    kind: 'CancelLabOrder',
    orderId: labOrderId(c['orderId'] as string),
    cancelledAt: isoTimestamp(c['cancelledAt'] as string),
  });
}

/**
 * Assembled as a single object literal checked with `satisfies` — see
 * __typetests__/lab.exhaustiveness.ts for the compile-time proof that
 * this is total over `LabInstruction`.
 */
export const labInstructionValidators = {
  OrderLabTest: validateOrderLabTest,
  ReportLabResult: validateReportLabResult,
  CancelLabOrder: validateCancelLabOrder,
} satisfies InstructionValidatorRegistry<LabInstruction>;
