import { createEngine } from '../../core/execution/engine.js';
import { nursingHandlerRegistry } from './handlers/index.js';
import type { NursingContext, NursingEffect, NursingError, NursingInstruction } from './types.js';

// Explicit type arguments: createEngine cannot infer TCtx/TInstruction/
// TEffect/TError from a mapped-type parameter (HandlerRegistry) — see
// docs/ARCHITECTURE.md and the equivalent fix in ../patient/engine.ts.
export const nursingEngine = createEngine<NursingContext, NursingInstruction, NursingEffect, NursingError>(
  nursingHandlerRegistry,
);
