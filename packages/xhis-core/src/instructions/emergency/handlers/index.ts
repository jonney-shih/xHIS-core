import type { HandlerRegistry } from '../../../core/execution/handler.js';
import type { EmergencyContext, EmergencyEffect, EmergencyError, EmergencyInstruction } from '../types.js';
import { dispositionPatientHandler } from './dispositionPatient.js';
import { registerEdVisitHandler } from './registerEdVisit.js';
import { triagePatientHandler } from './triagePatient.js';

/**
 * Assembled as a single object literal with arrow-function values and
 * checked with `satisfies` — never build this via `Object.assign`/spread,
 * which would lose the exhaustiveness check. See
 * __typetests__/exhaustiveness.ts for the compile-time proof that this
 * registry is total.
 */
export const emergencyHandlerRegistry = {
  RegisterEdVisit: registerEdVisitHandler,
  TriagePatient: triagePatientHandler,
  DispositionPatient: dispositionPatientHandler,
} satisfies HandlerRegistry<EmergencyContext, EmergencyInstruction, EmergencyEffect, EmergencyError>;
