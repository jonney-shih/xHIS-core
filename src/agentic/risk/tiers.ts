import type { Kinded } from '../../core/execution/kinded.js';

/**
 * How much scrutiny a proposal touching this instruction kind requires
 * before Act may commit it (see docs/AGENTIC_LAYER.md). Ordered low to
 * high — `tierRank` below encodes that order for computing a sequence's
 * effective tier.
 */
export type RiskTier = 'auto' | 'review-required' | 'approval-required';

/**
 * A registry that is *total* over `TInstruction['kind']` — every variant of
 * the closed instruction union must be assigned exactly one risk tier, or
 * the object literal assigned to this type fails to compile. Same mechanism
 * as `HandlerRegistry` (core/execution/handler.ts), applied to risk
 * classification instead of dispatch.
 */
export type RiskTierRegistry<TInstruction extends Kinded> = {
  readonly [K in TInstruction['kind']]: RiskTier;
};

const tierRank: Readonly<Record<RiskTier, number>> = {
  auto: 0,
  'review-required': 1,
  'approval-required': 2,
};

/**
 * A sequence's effective tier is the highest tier of any instruction it
 * contains — one `approval-required` instruction in a batch is enough to
 * gate the whole batch. An empty sequence is `'auto'`.
 *
 * This *does* need an unsafe cast, for the same reason `engine.ts`'s
 * dispatch does: a mapped type keyed by a still-generic `TInstruction['kind']`
 * has no index signature TypeScript will let you use with a same-shaped
 * generic key, even though every branch happens to share the value type
 * `RiskTier`. Cast the registry itself to a plain string-indexed record
 * first — casting the *lookup result* instead (`registry[k] as RiskTier`)
 * does not work, because the indexing expression is flagged before any
 * outer assertion is applied.
 */
export function effectiveTier<TInstruction extends Kinded>(
  registry: RiskTierRegistry<TInstruction>,
  instructions: readonly TInstruction[],
): RiskTier {
  const byKind = registry as unknown as Readonly<Record<string, RiskTier>>;
  let highest: RiskTier = 'auto';

  for (const instruction of instructions) {
    const tier = byKind[instruction.kind]!;
    if (tierRank[tier] > tierRank[highest]) {
      highest = tier;
    }
  }

  return highest;
}
