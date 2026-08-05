/**
 * Constraint every closed UI component-descriptor union must satisfy —
 * the UI-side counterpart to `core/execution/kinded.ts`'s `Kinded`.
 * `component` must stay a literal string per variant, and the union
 * itself must never be declared as an `interface` (interfaces merge,
 * which would silently reopen an otherwise-closed set) — the same two
 * rules `Kinded` states, restated here because this is a genuinely
 * different closed set (what the Agent may ask to render, not what it
 * may ask to execute), not a reuse of `Kinded` under a new name.
 * Keeping it distinct also keeps this module free of any dependency on
 * `core/execution` — nothing about rendering a UI belongs to the
 * instruction-execution core.
 */
export interface UiKinded {
  readonly component: string;
}
