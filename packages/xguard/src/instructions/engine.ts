import { createEngine } from '@xhis/core';
import { opsHandlerRegistry } from './handlers/index.js';
import type { OpsContext, OpsEffect, OpsError, OpsInstruction } from './types.js';

// Explicit type arguments: createEngine cannot infer TCtx/TInstruction/
// TEffect/TError from a mapped-type parameter (HandlerRegistry) — same
// fix `@xhis/core`'s own `instructions/bed/engine.ts` needs, for the
// identical reason (see docs/ARCHITECTURE.md).
export const opsEngine = createEngine<OpsContext, OpsInstruction, OpsEffect, OpsError>(opsHandlerRegistry);
