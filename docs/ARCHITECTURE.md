# xHIS-core architecture: the static execution core

`xHIS-core` is built around a **static execution core**: a deterministic
engine that runs a fixed, compile-time-known set of operations
("instructions"). "Static" here means the same thing it does for a compiled
language — the set of things the system can do is closed and known to the
compiler, as opposed to a system that interprets strings, loads plugins at
runtime, or `eval`s configuration. For a healthcare-domain core this buys
two properties that matter a lot: **auditability** (every state change is
"instruction X applied to context Y produced effects Z", nothing else) and
**exact replay** (the same instruction sequence against the same starting
context always produces the same result).

## The shape

```
Instruction (closed union) --dispatch--> Handler --returns--> { context, effects } | error
```

- **Instruction** — a domain defines its instructions as a single TypeScript
  discriminated union **type alias**, e.g. `PatientInstruction` in
  `src/instructions/patient/types.ts`. Never declare it as an `interface`
  (interfaces can be merged/augmented elsewhere, silently reopening what's
  supposed to be a closed set) and never widen the discriminant field
  (`kind`) to `string`.
- **Handler** — a pure function `(context, instruction) => Result<{ context, effects }, error>`.
  Handlers never perform I/O. They receive everything they need (including
  timestamps) as arguments and return a brand-new context plus a list of
  **effect descriptions** — data describing what should happen, not actions
  that have already happened.
- **HandlerRegistry** — a mapped type over `Instruction['kind']` that is
  *total*: every instruction variant must have exactly one handler, or the
  object literal assigned to this type fails to compile. This is the actual
  "static" guarantee — not a runtime check, a compiler proof.
- **Engine** (`createEngine`, in `src/core/execution/engine.ts`) — generic
  over any closed instruction union. `execute()` dispatches one instruction;
  `executeSequence()` folds over a batch with an all-or-nothing contract
  (see below).

`src/core/execution/**` is domain-agnostic and reusable. `src/instructions/patient/**`
is the first concrete consumer (`AdmitPatient`, `DischargePatient`), proving
the pattern end-to-end without prematurely modeling the rest of the clinical
domain.

## Rules that keep the exhaustiveness guarantee real

TypeScript's structural type system has real footguns here that would
silently defeat the "every instruction has a handler" guarantee if not
followed:

1. **Assemble the registry as one object literal, checked with `satisfies`.**
   Individual handlers can live in separate files, but the final assembly
   (see `src/instructions/patient/handlers/index.ts`) must be a single
   literal expression. Building it via `Object.assign` or spreading two
   partial registries together loses the compile-time check entirely.
2. **Use arrow-function values, never method shorthand, in that literal.**
   Under `strictFunctionTypes`, `{ Kind(ctx, i) {...} }` is checked
   *bivariantly* (weaker), while `{ Kind: (ctx, i) => {...} }` gets full
   *contravariant* checking. A wrong-shaped handler can slip past the
   bivariant check unnoticed.
3. **Every unsafe cast in this codebase follows the same, narrow pattern**:
   indexing a mapped type keyed by a still-generic `TInstruction['kind']`
   (e.g. `HandlerRegistry`) by a value of that same generic key type.
   TypeScript does not synthesize an index signature for a mapped type over
   an unresolved generic key, so the indexing expression itself has no
   valid type — not even `unknown` — regardless of what the *result* is
   cast to afterward. The fix is to cast the registry itself, first, to a
   plain string-indexed `Record`; only then does indexing by the key
   typecheck. This is safe in practice (property lookup by an exact string
   key is precise, and the registry is proven total at construction), just
   not something `tsc` itself can verify. The two sanctioned sites today are
   `engine.ts`'s `execute()` (dispatching a handler) and
   `agentic/risk/tiers.ts`'s `effectiveTier()` (looking up a risk tier) — see
   docs/AGENTIC_LAYER.md. Do not add a cast of a different shape than this
   one; route new "look up something keyed by an instruction's `kind`" needs
   through this same pattern.
4. **The real exhaustiveness proof lives in a `__typetests__` file**, not in
   prose. `src/instructions/patient/handlers/__typetests__/exhaustiveness.ts`
   builds a registry with a handler intentionally omitted, guarded by
   `@ts-expect-error`. If someone adds a new instruction variant and the
   registry stops being exhaustive somewhere, `tsc --noEmit` (the
   `typecheck` npm script) fails. This is the actual CI gate for the
   guarantee this whole design is built around.

## Determinism is a convention, backed by a cheap guard

The compiler enforces exhaustiveness, but nothing stops a handler body from
calling `Date.now()`, `Math.random()`, or doing ambient I/O — that's a
discipline problem, not a type problem. Two consequences:

- `ExecutionContext` types must stay plain, JSON-serializable data (no
  injected `Clock` or service objects with methods) — both because that's
  required for a context to be logged/replayed for audit, and because it
  closes off a disguised way to smuggle in ambient calls.
- `tests/instructions/patient/determinism.guard.test.ts` greps handler and
  core-execution source for a short list of banned identifiers (`Date.now`,
  `new Date`, `Math.random`, `fetch`, `process.env`, `fs` imports). It's
  deliberately low-tech — no new tooling/ESLint config — but it turns a
  convention into something CI actually checks.

## The all-or-nothing batch contract

`executeSequence` folds over a list of instructions and **short-circuits on
the first error**. On failure it returns a `SequenceFailure` carrying the
failing index, the error, and a `diagnosticPrefix` — the context/effects
accumulated from the instructions that succeeded before the failure.

That prefix is diagnostic-only. **The contract is: an outer shell may only
apply effects when `executeSequence` returns `ok` for the entire batch.**
This matters concretely for clinical order sets, where applying only the
first half of a batch could leave the system in a state nobody intended.
Nothing in the types forces a caller to respect this — it's enforced by
convention plus `tests/core/engine.sequence.test.ts`, the same way
determinism is.

## What's deliberately out of scope right now

- The **imperative shell** that actually interprets `Effect` values
  (persisting to a database, sending notifications, writing to an audit
  log) doesn't exist yet. The core is designed with that seam in mind
  (effects are data precisely so a shell can consume them later), but
  nothing here performs real I/O.
- No HTTP/API layer.
- No clinical domain modeling beyond the two proof-of-concept instructions
  (`AdmitPatient`, `DischargePatient`). Real domains (orders, medications,
  vitals, ...) should follow the same pattern: a closed instruction union, a
  total handler registry assembled as one `satisfies`-checked literal, an
  `__typetests__/exhaustiveness.ts` proof, and a `createEngine()` call.
