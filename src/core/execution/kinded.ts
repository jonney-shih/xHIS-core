/**
 * Constraint every closed instruction union must satisfy. `kind` must stay a
 * literal string per variant — never widen it to `string`, and never declare
 * an instruction union as an `interface` (interfaces can be merged/augmented,
 * which would silently reopen an otherwise-closed set).
 */
export interface Kinded {
  readonly kind: string;
}
