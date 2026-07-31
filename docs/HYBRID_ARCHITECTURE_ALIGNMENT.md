# Hybrid client-server architecture alignment: audit and plan

An audit against [`CLAUDE.md`](../CLAUDE.md)'s guardrails, requested to
identify boundary leaks between server-side (deterministic core + heavy
agentic AI) and client-side (edge UI, hardware bridges, local caching)
code, and to propose a reorganization plan. **No source code was
changed to produce this report** — every finding below was checked by
reading and searching the repository, not by modifying it, per the
explicit "audit and plan, don't rewrite" scope of this request.

## Headline finding

**There are no boundary leaks to fix, because there is no client-side
code in this repository at all yet.** `xHIS-core` is, in its entirety,
server-side: the deterministic core and the agentic layer built on it.
This isn't a gap in the audit — it's the actual, verified state of the
repository, confirmed by the checks below rather than assumed. The
useful output of this audit is therefore less "here are N leaks to
patch" and more "here is proof the boundary is already clean, plus the
seams to build against when client-side and heavier server-side pieces
(a real database, a real client) actually get added."

## Audit method

- `grep`/`grep -l` sweeps across all of `src/` for: hardware/peripheral
  keywords (barcode, scanner, IC/smart card, printer, serialport, USB,
  HID), HTTP server frameworks (Express, Fastify, `createServer`,
  `.listen(`), database drivers (`pg`, `mysql`, `mongodb`, `sqlite`,
  Prisma, TypeORM, Knex), literal FHIR/HL7 parsing, and
  React/DOM/browser API usage (`react`, `document.`, `window.`).
- `package.json`'s `dependencies`/`devDependencies` split, to confirm
  what actually ships as a runtime dependency versus tooling-only.
- Every `.commit(` call site in `src/`, to confirm nothing reaches a
  commit without first passing through a validation/Check gate.
- A structural read of every top-level directory under `src/` against
  the three guardrails in `CLAUDE.md`.

## What's already cleanly separated — no action needed

**Zero runtime dependencies, confirmed, not assumed.** `package.json`
has no `dependencies` key at all — only `devDependencies` (TypeScript,
ESLint, Vitest, Husky, `@types/node`). Nothing under `src/` can
accidentally pull in a client-only or server-only framework because
nothing pulls in *any* framework yet.

**No hardware/peripheral code anywhere.** The keyword sweep's only
hits were prose false positives (`scanner` inside a comment describing
the PDPA rule as "not a general PII/DLP scanner"; `hidden` inside an
unrelated comment). There is no IC-card, barcode, or printer
integration to misplace.

**No HTTP server, no database driver.** No Express/Fastify/`.listen(`
call, no `pg`/`mysql`/`mongodb`/Prisma/TypeORM/Knex import, anywhere.
`ImperativeShell`'s two real implementations (`createFileShell`,
`createInMemoryShell`) are explicitly documented as stand-ins — "the
simplest thing that is actually persistent, not a production-grade
store" — not an accidental database dependency masquerading as core
logic.

**No literal FHIR/HL7 parsing, and the one place that's adjacent says
so explicitly.** `src/integration/externalLabResultAdapter.ts` and
`externalMessageIdempotency.ts` both carry comments stating outright
that they use "a deliberately synthetic message shape — not real
HL7v2/FHIR wire" format, with `messageControlId` playing "the same role
HL7's MSH-10 plays in a real interface." The protocol-agnostic
*pattern* (durable log, durable cursor, idempotent consumer) is here on
purpose; real wire-format parsing was never built, and the comments
already say why.

**No React, DOM, or browser API usage.** The keyword sweep's hits were
all prose false positives (words like "before"/"document" inside
comments, e.g. "documentation," "before it reaches..."). Confirmed
directly in `src/agentic/ui/resolveUiRenderOutcome.ts`'s own doc
comment: "nothing under `src/` references `react` at all, on purpose."

**No Agentic AI path bypasses the Deterministic Core's safety
validation.** Every `.commit(` call site in `src/` was enumerated —
there are exactly four: `agentic/shell/act.ts`, `human/actHuman.ts`,
`core/io/relay.ts`, and `integration/externalLabResultAdapter.ts`. The
first two require a `VerifyDecision`/authorization resolution before
they're reachable at all; the latter two commit *reactions* to
effects a domain has already committed through one of the first two —
never raw Agentic AI output. There is no fifth path.

**`src/agentic/ui/` is already the correct client/server boundary,
drawn before this audit asked for one.** `UiKinded`/`UiRenderProposal`/
`resolveUiRenderOutcome` decide *what* to show, server-side, using data
Check has already validated; they never touch an actual render call.
This is precisely "Client-Side owns UI/view components, Server-Side
owns everything upstream of that decision" — already built, already
tested (`tests/agentic/ui/`), for two real components
(`ApprovalConfirmationPanel`, `VitalsEntryPanel`).

**The persistence seam is already an interface, not a concrete
store.** `act()`/`actHuman()`/`relayEffects` all depend on
`ImperativeShell`/`EffectCommitter` — interfaces — never on
`createFileShell` or `createInMemoryShell` directly. Swapping in a real
database later needs a new implementation of that interface, not a
change to any deterministic-core or agentic-layer file.

## Files needing light refactoring or untangling

**None.** The audit above is exhaustive over what exists in `src/`
today, and nothing found crosses a boundary — there is nothing to
untangle because there is only one side of the boundary built so far.
Manufacturing a "light refactor" here would mean inventing a problem
this repository doesn't have.

## What to watch for, and the adapter shape to build against

Not fixes — the seams to use when the pieces that don't exist yet get
built, so they land on the correct side by construction:

- **When a real client is built:** it should consume
  `UiRenderOutcome` (already a plain, JSON-serializable typed value)
  over whatever transport connects it to the server, and render only —
  never call `toUiRenderProposal`/`resolveUiRenderOutcome` itself.
  Duplicating that validation client-side would create two sources of
  truth for "what's a valid component," which is exactly the drift
  Guardrail #1 exists to prevent.
- **When a real database is wired in:** implement `ImperativeShell`
  and `EffectCommitter` against it. Nothing in `core/execution`,
  `agentic/shell`, or `human` needs to change shape — they were built
  against the interface from the start.
- **When an LLM vendor call is added for real** (today's
  `llmPlanner.ts` takes an injected, vendor-agnostic `CompletionFn`):
  keep it injected. The moment a specific vendor SDK gets imported
  directly inside `src/agentic`, this repository gains its first real
  runtime dependency — worth a deliberate decision when it happens, the
  same way `husky`/`eslint` were each flagged as "this codebase's first
  X tooling" when they were added, not slipped in silently.
- **When a low-latency edge assistant (dictation, UI automation,
  ambient notes) is built on a client:** it may call a Plan-shaped
  entry point to *propose*, but it must never be handed a path to
  `act()`, `actHuman()`, or any `ImperativeShell` directly. The same
  Check gate that applies to CDSS and LLM proposals today must apply to
  it too — see `AGENTIC_LAYER.md`'s "the agent never gets to skip the
  checks that apply to a human operator doing the same thing."

## Follow-up: turned into a cheap, CI-checked guard, not left as a markdown-only convention

`CLAUDE.md`'s guardrails had the identical shape
`docs/DETERMINISTIC_CORE_PATTERN.md`'s "Determinism is a convention,
backed by a cheap guard" already named: a compiler (or, here, a human
audit) can confirm a property holds *today*, but nothing stops it from
silently stopping being true tomorrow. `tests/architecture/hybridArchitectureBoundary.guard.test.ts`
closes that gap the same way `determinism.guard.test.ts` already did
for ambient time/randomness/IO: a grep-based sweep, scoped to all of
`src/` (not a narrow subdirectory — unlike the determinism guard,
`CLAUDE.md` states the *entire* repository is server-side, so there is
no subdirectory a client-only, hardware, or database-specific import
would ever be correct in), banning React imports, DOM `document.`/
`window.` API calls, HTTP server framework imports, database driver
imports, and hardware/peripheral SDK imports.

- **Proven against a real false-positive risk before being trusted, not
  just assumed safe.** A naive `/react/` bare-word pattern would have
  flagged `resolveUiRenderOutcome.ts`'s own comment — "nothing under
  `src/` references `react` at all, on purpose" — as a violation of the
  very thing it's asserting. Every pattern instead matches an actual
  import/require shape or a real API call shape (`document.foo`,
  `window.foo`), and the guard was run against the real, current `src/`
  tree first, confirming zero hits, before anything else.
- **Proven to actually catch a real violation, the same way the
  `no-commit-without-fresh-read` lint rule and every guard-test
  extension in this document were proven.** A scratch file importing
  `useState` from `react` was staged under `src/`, the guard test was
  run and confirmed to fail with exactly that file and reason named,
  and the scratch file was then deleted and the guard re-confirmed
  clean — before any of this was trusted enough to commit.
- **Deliberately as low-tech as `determinism.guard.test.ts`** — a plain
  `readFileSync`/regex sweep, no new lint infrastructure, no new
  dependency. This repository already has exactly one precedent for
  "when is custom tooling worth adding" (`eslint-rules/no-commit-without-fresh-read.js`,
  for a check regex couldn't express); a boundary-import check is not
  that case.
