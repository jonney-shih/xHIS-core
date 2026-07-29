import { createEngine } from '../../../src/core/execution/engine.js';
import type { HandlerRegistry } from '../../../src/core/execution/handler.js';
import type { Kinded } from '../../../src/core/execution/kinded.js';
import { err, ok } from '../../../src/core/execution/result.js';

/**
 * Minimal synthetic instruction set used only to exercise the generic
 * execution core in isolation, independent of the patient domain.
 */
export interface CounterContext {
  readonly value: number;
}

export type CounterInstruction =
  | { readonly kind: 'Increment'; readonly amount: number }
  | { readonly kind: 'Decrement'; readonly amount: number };

export type CounterEffect = { readonly kind: 'ValueChanged'; readonly value: number };
export type CounterError = { readonly kind: 'WouldGoNegative' };

// `CounterInstruction` already satisfies `Kinded` structurally; this line is
// just documentation of that fact for readers of the fixture.
type _AssertKinded = CounterInstruction extends Kinded ? true : never;
void (0 as unknown as _AssertKinded);

export const counterHandlerRegistry = {
  Increment: (ctx, instruction) => {
    const value = ctx.value + instruction.amount;
    return ok({ context: { value }, effects: [{ kind: 'ValueChanged', value }] });
  },
  Decrement: (ctx, instruction) => {
    const value = ctx.value - instruction.amount;
    if (value < 0) {
      return err({ kind: 'WouldGoNegative' });
    }
    return ok({ context: { value }, effects: [{ kind: 'ValueChanged', value }] });
  },
} satisfies HandlerRegistry<CounterContext, CounterInstruction, CounterEffect, CounterError>;

// Explicit type arguments: `createEngine` cannot infer TCtx/TInstruction/
// TEffect/TError from a mapped-type parameter (HandlerRegistry) — inference
// through a mapped type's generic key falls back to `unknown`/`Kinded`
// defaults, which then fails to match the concrete registry passed in. See
// `src/instructions/patient/engine.ts` for the same fix, applied first.
export const counterEngine = createEngine<CounterContext, CounterInstruction, CounterEffect, CounterError>(
  counterHandlerRegistry,
);
