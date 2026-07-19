import type { RiskTier } from '../risk/tiers.js';

/**
 * Which roles, any one of which is sufficient, may resolve a
 * needs-human-approval decision for a proposal at a given risk tier.
 *
 * `RiskTier` is a plain, already-concrete union — unlike `Instruction['kind']`
 * in `RiskTierRegistry`, it isn't a still-generic type parameter at the
 * point this type is used, so an ordinary `Record` already gets full
 * exhaustiveness checking from TypeScript. No mapped-type-over-generic-key
 * trick and no unsafe cast are needed here, unlike `HandlerRegistry`,
 * `RiskTierRegistry`, and `InstructionValidatorRegistry`.
 *
 * Roles for `'auto'` are never consulted in practice — Check accepts
 * `auto`-tier proposals outright, so they never produce a needs-human-
 * approval decision to resolve — but the key is still required so this
 * stays total over every `RiskTier`, the same discipline every other
 * registry in this codebase holds itself to.
 */
export type ApprovalPolicy = Readonly<Record<RiskTier, readonly string[]>>;
