import { err, type Result } from '../../core/execution/result.js';
import type { UiKinded } from './component.js';

/** Validates one untrusted candidate's props into a specific component
 * variant, or explains why it can't — the UI-side counterpart to
 * `validation/validator.ts`'s `InstructionValidator`. `candidate` is
 * `unknown` on purpose: this is the boundary where an Agent's raw JSON
 * output stops being trusted by default — Guardrail #1's "Runtime
 * Validation Layer," made concrete. */
export type ComponentPropsValidator<TComponent extends UiKinded> = (
  candidate: unknown,
) => Result<TComponent, readonly string[]>;

/**
 * A registry that is *total* over `TComponent['component']` — every
 * variant of the closed component-descriptor union must have exactly
 * one validator, or the object literal assigned to this type fails to
 * compile. Same mechanism as `HandlerRegistry`, `RiskTierRegistry`, and
 * `InstructionValidatorRegistry`, applied to UI props instead of
 * dispatch, risk classification, or instruction validation.
 */
export type ComponentPropsValidatorRegistry<TComponent extends UiKinded> = {
  readonly [K in TComponent['component']]: ComponentPropsValidator<Extract<TComponent, { component: K }>>;
};

/**
 * Validates one candidate against the registry for its declared
 * `component`. Same sanctioned unsafe cast `engine.ts`'s dispatch and
 * `validation/validator.ts`'s `validateInstruction` both need — see
 * docs/ARCHITECTURE.md for the general shape of that pattern.
 * `ComponentPropsValidatorRegistry` is a mapped type keyed by the
 * still-generic `TComponent['component']`; TypeScript synthesizes no
 * index signature for that, so the registry itself is cast to a plain
 * string-indexed record first, and only then indexed by the
 * candidate's `component`.
 */
export function validateComponent<TComponent extends UiKinded>(
  registry: ComponentPropsValidatorRegistry<TComponent>,
  candidate: unknown,
): Result<TComponent, readonly string[]> {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return err(['expected a component descriptor object']);
  }

  const component = (candidate as Record<string, unknown>)['component'];
  if (typeof component !== 'string') {
    return err(["expected a string 'component' field"]);
  }

  const byComponent = registry as unknown as Readonly<Record<string, ComponentPropsValidator<TComponent>>>;
  const validate = byComponent[component];
  if (!validate) {
    return err([`unknown component '${component}'`]);
  }

  return validate(candidate);
}
