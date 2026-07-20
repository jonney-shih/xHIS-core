import type { HandlerRegistry } from '../../../core/execution/handler.js';
import type { LabContext, LabEffect, LabError, LabInstruction } from '../types.js';
import { cancelLabOrderHandler } from './cancelLabOrder.js';
import { orderLabTestHandler } from './orderLabTest.js';
import { reportLabResultHandler } from './reportLabResult.js';

/**
 * Assembled as a single object literal with arrow-function values,
 * checked with `satisfies` — see docs/ARCHITECTURE.md for why that
 * matters, and __typetests__/exhaustiveness.ts for the compile-time proof
 * that this registry is total over `LabInstruction`.
 */
export const labHandlerRegistry = {
  OrderLabTest: orderLabTestHandler,
  ReportLabResult: reportLabResultHandler,
  CancelLabOrder: cancelLabOrderHandler,
} satisfies HandlerRegistry<LabContext, LabInstruction, LabEffect, LabError>;
