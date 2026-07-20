import { createEngine } from '../../core/execution/engine.js';
import { imagingHandlerRegistry } from './handlers/index.js';
import type { ImagingContext, ImagingEffect, ImagingError, ImagingInstruction } from './types.js';

// Explicit type arguments: createEngine cannot infer TCtx/TInstruction/
// TEffect/TError from a mapped-type parameter (HandlerRegistry) — see
// docs/ARCHITECTURE.md and the equivalent fix in ../patient/engine.ts.
export const imagingEngine = createEngine<ImagingContext, ImagingInstruction, ImagingEffect, ImagingError>(
  imagingHandlerRegistry,
);
