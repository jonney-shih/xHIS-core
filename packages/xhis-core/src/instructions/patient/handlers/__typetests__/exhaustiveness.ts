import type { HandlerRegistry } from '../../../../core/execution/handler.js';
import type { PatientContext, PatientEffect, PatientError, PatientInstruction } from '../../types.js';
import { admitPatientHandler } from '../admitPatient.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). This is
 * the real proof that the handler registry is total over PatientInstruction:
 * omitting a handler here must fail to compile. If someone adds a new
 * PatientInstruction variant without updating this file to still omit it
 * correctly, `tsc` will complain that the `@ts-expect-error` is unused,
 * which is exactly the signal that the registry is no longer exhaustive.
 */
const incomplete = {
  AdmitPatient: admitPatientHandler,
  // @ts-expect-error - DischargePatient intentionally omitted to prove the registry is total
} satisfies HandlerRegistry<PatientContext, PatientInstruction, PatientEffect, PatientError>;

void incomplete;
