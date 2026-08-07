import type { Handler, HandlerRegistry } from './handler.js';
import type { Kinded } from './kinded.js';
import type { ExecutionOutcome } from './outcome.js';
import { err, ok, type Result } from './result.js';
import { isoTimestamp } from '../temporal.js';
import { telemetry } from '../../telemetry/hook.js';

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

/**
 * Optional, caller-supplied context for the `HandlerException` telemetry
 * emitted below — never read from an ambient clock (`recordedAt` is a
 * plain string the caller already has, the same discipline every handler
 * in this codebase follows for time; see `determinism.guard.test.ts`).
 * Omitting this parameter entirely (every call site that predates
 * telemetry) emits nothing and changes no observable behavior: the
 * try/catch below still exists, but a handler that never throws (the
 * only case any existing test exercises) can never tell the difference.
 */
export interface HandlerExceptionTelemetryContext {
  readonly domain: string;
  readonly recordedAt: string;
}

export function createEngine<TCtx, TInstruction extends Kinded, TEffect, TError>(
  registry: HandlerRegistry<TCtx, TInstruction, TEffect, TError>,
) {
  function execute(
    ctx: TCtx,
    instruction: TInstruction,
    telemetryContext?: HandlerExceptionTelemetryContext,
  ): Result<ExecutionOutcome<TCtx, TEffect>, TError> {
    // Sanctioned unsafe cast — see docs/ARCHITECTURE.md for the general
    // rule this follows. `HandlerRegistry` is a mapped type keyed by the
    // still-generic `TInstruction['kind']`; TypeScript does not synthesize
    // an index signature for a mapped type over an unresolved generic key,
    // so `registry[instruction.kind]` has no valid index access at all —
    // not even to `unknown` — regardless of what the result is cast to
    // afterward. The fix is to cast `registry` itself, first, to a plain
    // string-indexed record; only then does indexing by `instruction.kind`
    // typecheck, and it already produces the correlated `Handler` type
    // without a second cast on the result. This is safe in practice, not
    // just asserted: JS property access by an exact string key is precise,
    // and `registry` is proven total over every instruction kind at
    // construction time (see HandlerRegistry). Do not add another cast like
    // this anywhere else — route new dispatch needs through this function
    // instead.
    const byKind = registry as unknown as Readonly<
      Record<string, Handler<TCtx, TInstruction, TEffect, TError>>
    >;
    const handler = byKind[instruction.kind]!;

    // Handlers are documented as pure `(ctx, instruction) -> Result`
    // functions that report failure through `TError`, never by throwing
    // — but a bug in a handler's own implementation is exactly the kind
    // of thing this codebase cannot type-check away. `HandlerException`
    // telemetry exists for that case specifically: a real, unexpected
    // exception, distinct from `SequenceFailure`'s well-typed `err` path
    // below, which every domain's own tests already exercise on purpose
    // and which is not something an operator needs paging for. Never
    // swallowed: the exception is always rethrown after telemetry fires,
    // so nothing about adding this changes what a caller ultimately
    // observes.
    try {
      return handler(ctx, instruction);
    } catch (thrown) {
      if (telemetryContext) {
        telemetry.emit({
          kind: 'HandlerException',
          domain: telemetryContext.domain,
          correlationId: instruction.kind,
          recordedAt: isoTimestamp(telemetryContext.recordedAt),
          message: thrown instanceof Error ? thrown.message : String(thrown),
        });
      }
      throw thrown;
    }
  }

  function executeSequence(
    ctx: TCtx,
    instructions: readonly TInstruction[],
    telemetryContext?: HandlerExceptionTelemetryContext,
  ): Result<ExecutionOutcome<TCtx, TEffect>, SequenceFailure<TCtx, TEffect, TError>> {
    let currentCtx = ctx;
    const effects: TEffect[] = [];

    for (let index = 0; index < instructions.length; index += 1) {
      const instruction = instructions[index]!;
      const result = execute(currentCtx, instruction, telemetryContext);

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
