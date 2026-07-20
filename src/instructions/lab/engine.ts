import { createEngine } from '../../core/execution/engine.js';
import { labHandlerRegistry } from './handlers/index.js';
import type { LabContext, LabEffect, LabError, LabInstruction } from './types.js';

// Explicit type arguments: createEngine cannot infer TCtx/TInstruction/
// TEffect/TError from a mapped-type parameter (HandlerRegistry) — see
// docs/ARCHITECTURE.md and the equivalent fix in ../patient/engine.ts.
export const labEngine = createEngine<LabContext, LabInstruction, LabEffect, LabError>(labHandlerRegistry);
