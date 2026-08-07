import { createEngine } from '../../core/execution/engine.js';
import { schedulingHandlerRegistry } from './handlers/index.js';
import type { SchedulingContext, SchedulingEffect, SchedulingError, SchedulingInstruction } from './types.js';

// Explicit type arguments: createEngine cannot infer TCtx/TInstruction/
// TEffect/TError from a mapped-type parameter (HandlerRegistry) — see
// docs/ARCHITECTURE.md and the equivalent fix in ../patient/engine.ts.
export const schedulingEngine = createEngine<SchedulingContext, SchedulingInstruction, SchedulingEffect, SchedulingError>(
  schedulingHandlerRegistry,
);
