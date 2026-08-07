# xHIS Hybrid Client-Server Architecture — Guardrails

This file documents the architectural boundaries this workspace's
packages must respect. It exists so future code generation — by a
human or an AI assistant — lands new code on the correct side of each
boundary by default, not by review-time correction.
See [`docs/HYBRID_ARCHITECTURE_ALIGNMENT.md`](docs/HYBRID_ARCHITECTURE_ALIGNMENT.md)
for the audit the first three boundaries were checked against, and
[`packages/xhis-core/tests/architecture/hybridArchitectureBoundary.guard.test.ts`](packages/xhis-core/tests/architecture/hybridArchitectureBoundary.guard.test.ts)
for the part of this file that's a CI-checked guard, not just a
convention — a React import, a `document.`/`window.` API call, an HTTP
server framework, a database driver, or a hardware/peripheral SDK
appearing anywhere under `packages/xhis-core/src` fails `npm test`.
The 4th boundary below (the Deterministic Foundation/XGuard split) has
its own equivalent guard — see that section.

## Where this repo sits today

This is an npm workspaces monorepo. `packages/xhis-core` (published
internally as `@xhis/core`) is, in its entirety, **server-side** code:
the deterministic execution core (`src/core`, `src/instructions`) and
the agentic layer built on top of it (`src/agentic`, `src/integration`,
`src/human`). There is no client-side code in this repository — no UI
framework, no browser API usage, no hardware/peripheral integration —
and `packages/xhis-core/package.json` has zero runtime dependencies
(only `devDependencies`, hoisted to the workspace root). Confirm this
is still true before assuming otherwise; a runtime dependency or a
`document`/`window`/hardware-SDK reference appearing under
`packages/xhis-core/src` would itself be a boundary violation, not
something this package has ever needed.

`packages/xguard` (`@xhis/xguard`) is a sibling package: the
operational/production agentic domain (K8s sandbox lifecycle
management, telemetry, self-healing) — see guardrail 4 below and
[`docs/XGUARD_INTEGRATION.md`](docs/XGUARD_INTEGRATION.md).

## The guardrails

### 1. Server-Side (Central Engine/Cloud)

Everything that must be trusted, consistent, and auditable across every
client belongs here:

- **The deterministic core** — ledger/conservation integrity, bed
  allocation, order routing, database integrity:
  `packages/xhis-core/src/core/execution`,
  `packages/xhis-core/src/core/io`, `packages/xhis-core/src/instructions/*`.
  One closed instruction union per domain, exhaustively dispatched, no
  `eval`, no runtime plugin loading — see
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- **FHIR/HL7 and other external-protocol transactions** — the adapter
  *pattern* exists (`packages/xhis-core/src/integration/externalLabResultAdapter.ts`,
  `externalMessageIdempotency.ts`), deliberately protocol-agnostic; real
  wire-format parsing for a specific protocol is real, separate work
  that belongs in this same layer when it's needed, not on the client.
- **Heavy Agentic AI** — complex CDSS, multi-patient analytics,
  cross-system reasoning, and the whole Plan → Check → Act (and
  UI-proposal) pipeline: `packages/xhis-core/src/agentic/*`. See
  [`docs/AGENTIC_LAYER.md`](docs/AGENTIC_LAYER.md)'s framing: "the agent
  only ever produces a proposal... it never gets to skip the checks that
  apply to a human operator doing the same thing."

### 2. Client-Side (Desktop/Laptop Edge)

Nothing on this list exists in this repository yet. When it's built —
here in a new top-level area, or in a companion repo — it must stay
confined to:

- **UI/view components** — rendering whatever `packages/xhis-core/src/agentic/ui/`'s
  `UiRenderOutcome` resolves to. The client renders; it never re-derives
  or re-validates a component descriptor the server already resolved.
- **Local input pre-validation** — client-side sanity checks only,
  never a replacement for `toUiRenderProposal`'s or `toPlanProposal`'s
  server-side validation gate.
- **Peripheral hardware bridges** — IC card readers, barcode scanners,
  printers.
- **Local offline caching** — active-ward MAR/patient lists, a
  read-through cache of server state, never the system of record.

### 3. Agentic Layer Split

- **Heavy reasoning** stays server-side, inside `packages/xhis-core/src/agentic` — CDSS,
  cross-system/multi-patient analytics, and anything that decides what
  to commit or what a `needs-human-approval` decision should show.
- **Low-latency edge assistants** — dictation, UI automation, ambient
  note-taking — are client-side by definition and do not exist in this
  repository. If one is ever added to a client codebase, it must never
  gain a direct path to `act()`/`actHuman()` or any
  `ImperativeShell.commit()`. It proposes; the server-side pipeline
  still Checks and Acts, exactly as it does for any other proposal
  source.

### 4. The Deterministic Foundation vs. XGuard

`packages/xhis-core` (`@xhis/core`) is the **Deterministic Foundation**:
domain-agnostic execution/verification/shell machinery plus a set of
*example* clinical domain instantiations of it (`instructions/bed`,
`agentic/risk/lab`, ...). `packages/xguard` (`@xhis/xguard`) is a
**consumer** of that foundation — a second, non-clinical domain
instantiation (K8s sandbox lifecycle management, telemetry-driven
self-healing) built the same way any new domain would be, on top of
the same Plan → Check → Act pipeline. See
[`docs/XGUARD_INTEGRATION.md`](docs/XGUARD_INTEGRATION.md) for the full
rationale and current scope.

The dependency direction is one-way and enforced in both directions:

- **`@xhis/core` never depends on `@xhis/xguard`, or on any clinical
  specifics beyond its own example domains.** It must stay usable by
  any future domain — clinical or not — without ever needing to change
  shape for one. Concretely: nothing under `packages/xhis-core/src` may
  import, reference, or even mention `xguard` (including in comments —
  the guard below is a plain substring match, deliberately naive, the
  same convention every other `*.guard.test.ts` in this codebase
  follows). If `@xhis/core` ever seems to need to know something
  `@xhis/xguard`-specific, that is a sign the abstraction belongs in
  `@xhis/core`'s own domain-agnostic surface instead (e.g. the
  `TelemetryEvent` union — general enough for any domain, not an
  XGuard-specific type), not that the dependency direction should
  reverse.
- **`@xhis/xguard` depends only on `@xhis/core`'s public package-level
  export** — `import { ... } from '@xhis/core'`, resolving to
  `packages/xhis-core/src/index.ts` — **never a deep path** into its
  internals (`@xhis/core/dist/agentic/shell/act.js`, a relative
  `../xhis-core/src/...` reach-around, etc.). `@xhis/core`'s internal
  module layout is free to change behind that seam precisely because
  nothing outside it is allowed to depend on the shape directly.

Both directions are CI-enforced by
[`packages/xguard/tests/architecture/coreBoundary.guard.test.ts`](packages/xguard/tests/architecture/coreBoundary.guard.test.ts) —
the same "turn a convention into something CI actually checks" move
`hybridArchitectureBoundary.guard.test.ts` already made for guardrails
1–3.

## Rules for future code generation

- Code that touches a filesystem/database directly, calls out to an LLM
  vendor, or decides whether a proposal is allowed to commit belongs in
  `packages/xhis-core/src/agentic`, `packages/xhis-core/src/core`, or
  `packages/xhis-core/src/instructions` — not in any future client
  package.
- Code that touches `react`, a DOM/browser API, or a hardware/peripheral
  SDK, or that renders anything, does not belong in `@xhis/core` at all.
  Stop and flag it rather than adding it here.
- `packages/xhis-core/src/agentic/ui/` is the seam, not a place for
  rendering logic: it produces a typed, validated `UiRenderOutcome` and
  stops there. See `docs/DETERMINISTIC_CORE_PATTERN.md`'s "Resolved:
  Generative UI as a third instance of the same containment pattern."
- Never let an Agentic AI proposal — instructions or UI — reach a
  `commit()` call without first passing through the validated-union
  gate and Check (`combineVerifiers`/the verification spine). See
  `docs/AGENTIC_LAYER.md` and `docs/DETERMINISTIC_CORE_PATTERN.md`. This
  applies equally to `@xhis/xguard`'s own `ops` domain — a remediation
  proposal is never exempt from Check just because a deterministic rule
  (not an LLM) produced it.
- When a real database or a real client eventually needs wiring in,
  implement against the existing `ImperativeShell`/`UiRenderOutcome`
  seams rather than reaching into `act()`/`actHuman()`/`core/execution`
  directly — those seams exist specifically so the deterministic core
  never needs to change shape to support a new backing store or a new
  client.
- A new domain — clinical or operational — is a new *consumer* of
  `@xhis/core`'s public export surface, either inside
  `packages/xhis-core/src` (if it's an example clinical domain
  alongside `bed`/`lab`/...) or as its own sibling package (if it's
  something like `@xhis/xguard`). It is never a reason to add
  domain-specific code, or a reference to the new domain's name, inside
  `@xhis/core` itself.
