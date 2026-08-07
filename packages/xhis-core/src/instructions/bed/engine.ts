import { createEngine } from '../../core/execution/engine.js';
import { bedHandlerRegistry } from './handlers/index.js';
import type { BedContext, BedEffect, BedError, BedInstruction } from './types.js';

// Explicit type arguments: createEngine cannot infer TCtx/TInstruction/
// TEffect/TError from a mapped-type parameter (HandlerRegistry) — see
// docs/ARCHITECTURE.md and the equivalent fix in ../patient/engine.ts.
export const bedEngine = createEngine<BedContext, BedInstruction, BedEffect, BedError>(bedHandlerRegistry);
