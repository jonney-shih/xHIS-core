import type { ComponentPropsValidatorRegistry } from '../../../../../src/agentic/ui/validator.js';
import { exampleComponentPropsValidators } from '../exampleComponents.js';
import type { ExampleUiComponent } from '../exampleComponents.js';

/**
 * Not executed — checked by `npm run typecheck`. This is the real proof
 * that a `ComponentPropsValidatorRegistry` is total over
 * `ExampleUiComponent`: omitting a validator here must fail to compile.
 * Mirrors `src/instructions/patient/handlers/__typetests__/exhaustiveness.ts`'s
 * pattern exactly, applied to component props instead of instruction
 * handlers. Only checkable at all because `tsconfig.typecheck.json` now
 * actually typechecks `tests/` — see docs/DETERMINISTIC_CORE_PATTERN.md's
 * "Resolved: `tsconfig.json` never actually typechecked `tests/`".
 */
const incomplete = {
  VitalsEntryPanel: exampleComponentPropsValidators.VitalsEntryPanel,
  // @ts-expect-error - PatientSummaryCard intentionally omitted to prove the registry is total
} satisfies ComponentPropsValidatorRegistry<ExampleUiComponent>;

void incomplete;
