import { createEngine } from '../../core/execution/engine.js';
import { pharmacyHandlerRegistry } from './handlers/index.js';
import type { PharmacyContext, PharmacyEffect, PharmacyError, PharmacyInstruction } from './types.js';

// Explicit type arguments: createEngine cannot infer TCtx/TInstruction/
// TEffect/TError from a mapped-type parameter (HandlerRegistry) — see
// docs/ARCHITECTURE.md and the equivalent fix in ../patient/engine.ts.
export const pharmacyEngine = createEngine<PharmacyContext, PharmacyInstruction, PharmacyEffect, PharmacyError>(pharmacyHandlerRegistry);
