/**
 * What a handler produces: a new (never mutated) context plus a list of
 * effect *descriptions*. Handlers never perform I/O themselves — an outer
 * shell (not part of this scaffold) is responsible for interpreting effects.
 * That seam is what keeps handlers pure and mock-free to test, and doubles
 * as an audit trail: the effect list is the record of what would happen.
 */
export interface ExecutionOutcome<TCtx, TEffect> {
  readonly context: TCtx;
  readonly effects: readonly TEffect[];
}
