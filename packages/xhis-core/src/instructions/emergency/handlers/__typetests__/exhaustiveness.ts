import type { HandlerRegistry } from '../../../../core/execution/handler.js';
import type { EmergencyContext, EmergencyEffect, EmergencyError, EmergencyInstruction } from '../../types.js';
import { registerEdVisitHandler } from '../registerEdVisit.js';
import { triagePatientHandler } from '../triagePatient.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). The
 * compile-time proof that `emergencyHandlerRegistry` is total over
 * `EmergencyInstruction`: omitting a handler here must fail to compile.
 */
const incomplete = {
  RegisterEdVisit: registerEdVisitHandler,
  TriagePatient: triagePatientHandler,
  // @ts-expect-error - DispositionPatient intentionally omitted to prove the registry is total
} satisfies HandlerRegistry<EmergencyContext, EmergencyInstruction, EmergencyEffect, EmergencyError>;

void incomplete;
