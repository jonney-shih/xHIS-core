import { createEngine } from '../../core/execution/engine.js';
import { patientHandlerRegistry } from './handlers/index.js';
import type { PatientContext, PatientEffect, PatientError, PatientInstruction } from './types.js';

// Explicit type arguments: `createEngine` cannot infer TCtx/TInstruction/
// TEffect/TError from a mapped-type parameter (HandlerRegistry) — inference
// through a mapped type's generic key falls back to `unknown`/`Kinded`
// defaults, which then fails to match the concrete registry passed in.
export const patientEngine = createEngine<PatientContext, PatientInstruction, PatientEffect, PatientError>(
  patientHandlerRegistry,
);
