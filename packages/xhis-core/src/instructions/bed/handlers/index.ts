import type { HandlerRegistry } from '../../../core/execution/handler.js';
import type { BedContext, BedEffect, BedError, BedInstruction } from '../types.js';
import { assignBedHandler } from './assignBed.js';
import { releaseBedHandler } from './releaseBed.js';

/**
 * Assembled as a single object literal with arrow-function values,
 * checked with `satisfies` — see docs/ARCHITECTURE.md for why that
 * matters, and __typetests__/exhaustiveness.ts for the compile-time proof
 * that this registry is total over `BedInstruction`.
 */
export const bedHandlerRegistry = {
  AssignBed: assignBedHandler,
  ReleaseBed: releaseBedHandler,
} satisfies HandlerRegistry<BedContext, BedInstruction, BedEffect, BedError>;
