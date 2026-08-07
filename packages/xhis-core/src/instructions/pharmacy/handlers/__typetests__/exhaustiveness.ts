import type { HandlerRegistry } from '../../../../core/execution/handler.js';
import type { PharmacyContext, PharmacyEffect, PharmacyError, PharmacyInstruction } from '../../types.js';
import { prescribeMedicationHandler } from '../prescribeMedication.js';

/**
 * Not executed — checked by `npm run typecheck` (`tsc --noEmit`). The
 * compile-time proof that `pharmacyHandlerRegistry` is total over
 * `PharmacyInstruction`: omitting a handler here must fail to compile. If
 * someone adds a new `PharmacyInstruction` variant without updating this
 * file to still omit it correctly, `tsc` will complain that the
 * `@ts-expect-error` is unused — the signal that the registry is no
 * longer exhaustive.
 */
const incomplete = {
  PrescribeMedication: prescribeMedicationHandler,
  // @ts-expect-error - DispenseMedication intentionally omitted to prove the registry is total
} satisfies HandlerRegistry<PharmacyContext, PharmacyInstruction, PharmacyEffect, PharmacyError>;

void incomplete;
