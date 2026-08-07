import type { HandlerRegistry } from '../../../../core/execution/handler.js';
import type { LabContext, LabEffect, LabError, LabInstruction } from '../../types.js';
import { orderLabTestHandler } from '../orderLabTest.js';
import { reportLabResultHandler } from '../reportLabResult.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). The
 * compile-time proof that `labHandlerRegistry` is total over
 * `LabInstruction`: omitting a handler here must fail to compile. If
 * someone adds a new `LabInstruction` variant without updating this file
 * to still omit it correctly, `tsc` will complain that the
 * `@ts-expect-error` is unused — the signal that the registry is no
 * longer exhaustive.
 */
const incomplete = {
  OrderLabTest: orderLabTestHandler,
  ReportLabResult: reportLabResultHandler,
  // @ts-expect-error - CancelLabOrder intentionally omitted to prove the registry is total
} satisfies HandlerRegistry<LabContext, LabInstruction, LabEffect, LabError>;

void incomplete;
