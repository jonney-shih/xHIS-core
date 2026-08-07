import type { HandlerRegistry } from '../../../core/execution/handler.js';
import type { PatientContext, PatientEffect, PatientError, PatientInstruction } from '../types.js';
import { admitPatientHandler } from './admitPatient.js';
import { dischargePatientHandler } from './dischargePatient.js';

/**
 * Assembled as a single object literal with arrow-function values (imported,
 * but the assembly itself is one literal expression) and checked with
 * `satisfies` — never build this via `Object.assign`/spread, which would
 * lose the exhaustiveness check. See __typetests__/exhaustiveness.ts for the
 * compile-time proof that this registry is total.
 */
export const patientHandlerRegistry = {
  AdmitPatient: admitPatientHandler,
  DischargePatient: dischargePatientHandler,
} satisfies HandlerRegistry<PatientContext, PatientInstruction, PatientEffect, PatientError>;
