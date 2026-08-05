import type { HandlerRegistry } from '../../../../core/execution/handler.js';
import type { BedContext, BedEffect, BedError, BedInstruction } from '../../types.js';
import { assignBedHandler } from '../assignBed.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). The
 * compile-time proof that `bedHandlerRegistry` is total over
 * `BedInstruction`: omitting a handler here must fail to compile. If
 * someone adds a new `BedInstruction` variant without updating this file
 * to still omit it correctly, `tsc` will complain that the
 * `@ts-expect-error` is unused — the signal that the registry is no
 * longer exhaustive.
 */
const incomplete = {
  AssignBed: assignBedHandler,
  // @ts-expect-error - ReleaseBed intentionally omitted to prove the registry is total
} satisfies HandlerRegistry<BedContext, BedInstruction, BedEffect, BedError>;

void incomplete;
