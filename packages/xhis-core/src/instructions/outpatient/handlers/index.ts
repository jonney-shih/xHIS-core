import type { HandlerRegistry } from '../../../core/execution/handler.js';
import type { OutpatientContext, OutpatientEffect, OutpatientError, OutpatientInstruction } from '../types.js';
import { checkInPatientHandler } from './checkInPatient.js';
import { completeEncounterHandler } from './completeEncounter.js';
import { finalizeSoapNoteHandler } from './finalizeSoapNote.js';
import { placeCpoeOrderHandler } from './placeCpoeOrder.js';
import { recordSoapNoteHandler } from './recordSoapNote.js';

/**
 * Assembled as a single object literal with arrow-function values and
 * checked with `satisfies` — never build this via `Object.assign`/spread,
 * which would lose the exhaustiveness check. See
 * __typetests__/exhaustiveness.ts for the compile-time proof that this
 * registry is total.
 */
export const outpatientHandlerRegistry = {
  CheckInPatient: checkInPatientHandler,
  RecordSoapNote: recordSoapNoteHandler,
  FinalizeSoapNote: finalizeSoapNoteHandler,
  PlaceCpoeOrder: placeCpoeOrderHandler,
  CompleteEncounter: completeEncounterHandler,
} satisfies HandlerRegistry<OutpatientContext, OutpatientInstruction, OutpatientEffect, OutpatientError>;
