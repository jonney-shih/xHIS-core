import type { Kinded } from '../../core/execution/kinded.js';
import { err, ok, type Result } from '../../core/execution/result.js';

/** Validates one untrusted candidate into a specific instruction variant,
 * or explains why it can't. `candidate` is `unknown` on purpose — this is
 * the boundary where an untrusted planner's raw output stops being trusted
 * by default. */
export type InstructionValidator<TInstruction extends Kinded> = (
  candidate: unknown,
) => Result<TInstruction, readonly string[]>;

/**
 * A registry that is *total* over `TInstruction['kind']` — every variant of
 * the closed instruction union must have exactly one validator, or the
 * object literal assigned to this type fails to compile. Same mechanism as
 * `HandlerRegistry` (core/execution/handler.ts) and `RiskTierRegistry`
 * (agentic/risk/tiers.ts), applied to untrusted-input validation instead of
 * dispatch or risk classification.
 */
export type InstructionValidatorRegistry<TInstruction extends Kinded> = {
  readonly [K in TInstruction['kind']]: InstructionValidator<Extract<TInstruction, { kind: K }>>;
};

export interface IndexedValidationIssues {
  readonly index: number;
  readonly issues: readonly string[];
}

/**
 * Validates one candidate against the registry for its declared `kind`.
 *
 * This needs the same sanctioned unsafe cast as `engine.ts`'s dispatch —
 * see docs/ARCHITECTURE.md for the general shape of that pattern.
 * `InstructionValidatorRegistry` is a mapped type keyed by the still-generic
 * `TInstruction['kind']`; TypeScript synthesizes no index signature for
 * that, so the registry itself is cast to a plain string-indexed record
 * first, and only then indexed by the candidate's `kind`.
 */
export function validateInstruction<TInstruction extends Kinded>(
  registry: InstructionValidatorRegistry<TInstruction>,
  candidate: unknown,
): Result<TInstruction, readonly string[]> {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return err(['expected an instruction object']);
  }

  const kind = (candidate as Record<string, unknown>)['kind'];
  if (typeof kind !== 'string') {
    return err(["expected a string 'kind' field"]);
  }

  const byKind = registry as unknown as Readonly<Record<string, InstructionValidator<TInstruction>>>;
  const validate = byKind[kind];
  if (!validate) {
    return err([`unknown instruction kind '${kind}'`]);
  }

  return validate(candidate);
}

/**
 * Validates a whole batch. Collects issues from *every* invalid candidate
 * (not just the first) — useful for showing everything wrong at once, e.g.
 * in a retry prompt back to an LLM planner. All-or-nothing: any failure
 * rejects the whole batch, same principle as `executeSequence`'s all-or-
 * nothing batch contract — there is no such thing as a partially-trusted
 * proposal.
 */
export function validateInstructions<TInstruction extends Kinded>(
  registry: InstructionValidatorRegistry<TInstruction>,
  candidates: readonly unknown[],
): Result<readonly TInstruction[], readonly IndexedValidationIssues[]> {
  const instructions: TInstruction[] = [];
  const failures: IndexedValidationIssues[] = [];

  candidates.forEach((candidate, index) => {
    const result = validateInstruction(registry, candidate);
    if (result.ok) {
      instructions.push(result.value);
    } else {
      failures.push({ index, issues: result.error });
    }
  });

  if (failures.length > 0) {
    return err(failures);
  }

  return ok(instructions);
}
