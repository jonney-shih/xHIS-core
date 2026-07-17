import type { Kinded } from './kinded.js';
import type { ExecutionOutcome } from './outcome.js';
import type { Result } from './result.js';

/** A pure function: (context, instruction) -> new context + effects, or an error. */
export type Handler<TCtx, I extends Kinded, TEffect, TError> = (
  ctx: TCtx,
  instruction: I,
) => Result<ExecutionOutcome<TCtx, TEffect>, TError>;

/**
 * A registry that is *total* over `TInstruction['kind']` — every variant of
 * the closed instruction union must have exactly one handler, or the object
 * literal assigned to this type fails to compile.
 *
 * This guarantee only holds if the registry is assembled as a single object
 * literal with arrow-function values (see `instructions/patient/handlers/index.ts`
 * for the pattern) — never via `Object.assign`/spread, and never with method
 * shorthand (`{ Kind(ctx, i) {...} }` is checked bivariantly under
 * `strictFunctionTypes`, which is weaker than the contravariant check arrow
 * functions get, and can let a wrong-shaped handler slip through unnoticed).
 */
export type HandlerRegistry<TCtx, TInstruction extends Kinded, TEffect, TError> = {
  [K in TInstruction['kind']]: Handler<TCtx, Extract<TInstruction, { kind: K }>, TEffect, TError>;
};
