import type { HandlerRegistry } from '../../../../core/execution/handler.js';
import type { OutpatientContext, OutpatientEffect, OutpatientError, OutpatientInstruction } from '../../types.js';
import { checkInPatientHandler } from '../checkInPatient.js';
import { finalizeSoapNoteHandler } from '../finalizeSoapNote.js';
import { placeCpoeOrderHandler } from '../placeCpoeOrder.js';
import { recordSoapNoteHandler } from '../recordSoapNote.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). The
 * compile-time proof that `outpatientHandlerRegistry` is total over
 * `OutpatientInstruction`: omitting a handler here must fail to compile.
 */
const incomplete = {
  CheckInPatient: checkInPatientHandler,
  RecordSoapNote: recordSoapNoteHandler,
  FinalizeSoapNote: finalizeSoapNoteHandler,
  PlaceCpoeOrder: placeCpoeOrderHandler,
  // @ts-expect-error - CompleteEncounter intentionally omitted to prove the registry is total
} satisfies HandlerRegistry<OutpatientContext, OutpatientInstruction, OutpatientEffect, OutpatientError>;

void incomplete;
