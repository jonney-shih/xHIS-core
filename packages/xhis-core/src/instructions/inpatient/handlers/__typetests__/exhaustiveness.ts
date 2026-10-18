import type { HandlerRegistry } from '../../../../core/execution/handler.js';
import type { InpatientContext, InpatientEffect, InpatientError, InpatientInstruction } from '../../types.js';
import { assignWardHandler } from '../assignWard.js';
import { finalizeProgressNoteHandler } from '../finalizeProgressNote.js';
import { recordProgressNoteHandler } from '../recordProgressNote.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). The
 * compile-time proof that `inpatientHandlerRegistry` is total over
 * `InpatientInstruction`: omitting a handler here must fail to compile.
 */
const incomplete = {
  AssignWard: assignWardHandler,
  RecordProgressNote: recordProgressNoteHandler,
  FinalizeProgressNote: finalizeProgressNoteHandler,
  // @ts-expect-error - TransferWard intentionally omitted to prove the registry is total
} satisfies HandlerRegistry<InpatientContext, InpatientInstruction, InpatientEffect, InpatientError>;

void incomplete;
