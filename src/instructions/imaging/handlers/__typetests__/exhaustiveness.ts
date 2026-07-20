import type { HandlerRegistry } from '../../../../core/execution/handler.js';
import type { ImagingContext, ImagingEffect, ImagingError, ImagingInstruction } from '../../types.js';
import { orderStudyHandler } from '../orderStudy.js';
import { recordStudyStoredHandler } from '../recordStudyStored.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). The
 * compile-time proof that `imagingHandlerRegistry` is total over
 * `ImagingInstruction`: omitting a handler here must fail to compile.
 */
const incomplete = {
  OrderStudy: orderStudyHandler,
  RecordStudyStored: recordStudyStoredHandler,
  // @ts-expect-error - ReportStudy intentionally omitted to prove the registry is total
} satisfies HandlerRegistry<ImagingContext, ImagingInstruction, ImagingEffect, ImagingError>;

void incomplete;
