import type { HandlerRegistry } from '../../../core/execution/handler.js';
import type { PharmacyContext, PharmacyEffect, PharmacyError, PharmacyInstruction } from '../types.js';
import { dispenseMedicationHandler } from './dispenseMedication.js';
import { prescribeMedicationHandler } from './prescribeMedication.js';

/**
 * Assembled as a single object literal with arrow-function values,
 * checked with `satisfies` — see docs/ARCHITECTURE.md for why that
 * matters, and __typetests__/exhaustiveness.ts for the compile-time proof
 * that this registry is total over `PharmacyInstruction`.
 */
export const pharmacyHandlerRegistry = {
  PrescribeMedication: prescribeMedicationHandler,
  DispenseMedication: dispenseMedicationHandler,
} satisfies HandlerRegistry<PharmacyContext, PharmacyInstruction, PharmacyEffect, PharmacyError>;
