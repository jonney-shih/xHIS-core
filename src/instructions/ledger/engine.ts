import { createEngine } from '../../core/execution/engine.js';
import { ledgerHandlerRegistry } from './handlers/index.js';
import type { LedgerContext, LedgerEffect, LedgerError, LedgerInstruction } from './types.js';

// Explicit type arguments: createEngine cannot infer TCtx/TInstruction/
// TEffect/TError from a mapped-type parameter (HandlerRegistry) — see
// docs/ARCHITECTURE.md and the equivalent fix in ../patient/engine.ts.
export const ledgerEngine = createEngine<LedgerContext, LedgerInstruction, LedgerEffect, LedgerError>(
  ledgerHandlerRegistry,
);
