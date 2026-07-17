import type { Handler, HandlerRegistry } from './handler.js';
import type { Kinded } from './kinded.js';
import type { ExecutionOutcome } from './outcome.js';
import { err, ok, type Result } from './result.js';

/**
 * A batch failed partway through. `diagnosticPrefix` is the context/effects
 * accumulated from the successful instructions *before* the failure — it is
 * for logging/debugging only. Contract: the shell may only apply effects when
 * `executeSequence` returns `ok` for the entire batch. A partial prefix must
 * never be applied, since clinical order sets are not safe to apply partially.
 */
export interface SequenceFailure<TCtx, TEffect, TError> {
  readonly failedAtIndex: number;
  readonly error: TError;
  readonly diagnosticPrefix: ExecutionOutcome<TCtx, TEffect>;
}

export function createEngine<TCtx, TInstruction extends Kinded, TEffect, TError>(
  registry: HandlerRegistry<TCtx, TInstruction, TEffect, TError>,
) {
  function execute(
    ctx: TCtx,
    instruction: TInstruction,
  ): Result<ExecutionOutcome<TCtx, TEffect>, TError> {
    // Sanctioned unsafe cast — the ONE place in this codebase that casts past
    // TypeScript's "correlated union" limitation: it cannot narrow a
    // union-valued key (`instruction.kind`) together with the union member
    // (`instruction`) that key came from, so the property lookup below types
    // as a union of handlers rather than the one matching handler. This is
    // safe in practice, not just asserted: JS property access by an exact
    // string key is precise, and `registry` is proven total over every
    // instruction kind at construction time (see HandlerRegistry). Do not
    // add another cast like this anywhere else — route new dispatch needs
    // through this function instead.
    const handler = registry[instruction.kind] as Handler<TCtx, TInstruction, TEffect, TError>;
    return handler(ctx, instruction);
  }

  function executeSequence(
    ctx: TCtx,
    instructions: readonly TInstruction[],
  ): Result<ExecutionOutcome<TCtx, TEffect>, SequenceFailure<TCtx, TEffect, TError>> {
    let currentCtx = ctx;
    const effects: TEffect[] = [];

    for (let index = 0; index < instructions.length; index += 1) {
      const instruction = instructions[index]!;
      const result = execute(currentCtx, instruction);

      if (!result.ok) {
        return err({
          failedAtIndex: index,
          error: result.error,
          diagnosticPrefix: { context: currentCtx, effects },
        });
      }

      currentCtx = result.value.context;
      effects.push(...result.value.effects);
    }

    return ok({ context: currentCtx, effects });
  }

  return { execute, executeSequence };
}
