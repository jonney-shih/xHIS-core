import type { HandlerRegistry } from '../../../core/execution/handler.js';
import type { InpatientContext, InpatientEffect, InpatientError, InpatientInstruction } from '../types.js';
import { assignWardHandler } from './assignWard.js';
import { finalizeProgressNoteHandler } from './finalizeProgressNote.js';
import { recordProgressNoteHandler } from './recordProgressNote.js';
import { transferWardHandler } from './transferWard.js';

/**
 * Assembled as a single object literal with arrow-function values and
 * checked with `satisfies` — never build this via `Object.assign`/spread,
 * which would lose the exhaustiveness check. See
 * __typetests__/exhaustiveness.ts for the compile-time proof that this
 * registry is total.
 */
export const inpatientHandlerRegistry = {
  AssignWard: assignWardHandler,
  TransferWard: transferWardHandler,
  RecordProgressNote: recordProgressNoteHandler,
  FinalizeProgressNote: finalizeProgressNoteHandler,
} satisfies HandlerRegistry<InpatientContext, InpatientInstruction, InpatientEffect, InpatientError>;
