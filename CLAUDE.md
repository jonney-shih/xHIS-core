# xHIS Hybrid Client-Server Architecture — Guardrails

This file documents the architectural boundary `xHIS-core` and any
future client-side companion project must respect. It exists so future
code generation — by a human or an AI assistant — lands new code on the
correct side of the boundary by default, not by review-time correction.
See [`docs/HYBRID_ARCHITECTURE_ALIGNMENT.md`](docs/HYBRID_ARCHITECTURE_ALIGNMENT.md)
for the audit these boundaries were checked against.

## Where this repo sits today

`xHIS-core` is, in its entirety, **server-side** code: the deterministic
execution core (`src/core`, `src/instructions`) and the agentic layer
built on top of it (`src/agentic`, `src/integration`, `src/human`).
There is no client-side code in this repository — no UI framework, no
browser API usage, no hardware/peripheral integration — and
`package.json` has zero runtime dependencies (only `devDependencies`).
Confirm this is still true before assuming otherwise; a runtime
dependency or a `document`/`window`/hardware-SDK reference appearing
under `src/` would itself be a boundary violation, not something this
repo has ever needed.

## The three guardrails

### 1. Server-Side (Central Engine/Cloud)

Everything that must be trusted, consistent, and auditable across every
client belongs here:

- **The deterministic core** — ledger/conservation integrity, bed
  allocation, order routing, database integrity: `src/core/execution`,
  `src/core/io`, `src/instructions/*`. One closed instruction union per
  domain, exhaustively dispatched, no `eval`, no runtime plugin loading
  — see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- **FHIR/HL7 and other external-protocol transactions** — the adapter
  *pattern* exists (`src/integration/externalLabResultAdapter.ts`,
  `externalMessageIdempotency.ts`), deliberately protocol-agnostic; real
  wire-format parsing for a specific protocol is real, separate work
  that belongs in this same layer when it's needed, not on the client.
- **Heavy Agentic AI** — complex CDSS, multi-patient analytics,
  cross-system reasoning, and the whole Plan → Check → Act (and
  UI-proposal) pipeline: `src/agentic/*`. See
  [`docs/AGENTIC_LAYER.md`](docs/AGENTIC_LAYER.md)'s framing: "the agent
  only ever produces a proposal... it never gets to skip the checks that
  apply to a human operator doing the same thing."

### 2. Client-Side (Desktop/Laptop Edge)

Nothing on this list exists in this repository yet. When it's built —
here in a new top-level area, or in a companion repo — it must stay
confined to:

- **UI/view components** — rendering whatever `src/agentic/ui/`'s
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

- **Heavy reasoning** stays server-side, inside `src/agentic` — CDSS,
  cross-system/multi-patient analytics, and anything that decides what
  to commit or what a `needs-human-approval` decision should show.
- **Low-latency edge assistants** — dictation, UI automation, ambient
  note-taking — are client-side by definition and do not exist in this
  repository. If one is ever added to a client codebase, it must never
  gain a direct path to `act()`/`actHuman()` or any
  `ImperativeShell.commit()`. It proposes; the server-side pipeline
  still Checks and Acts, exactly as it does for any other proposal
  source.

## Rules for future code generation

- Code that touches a filesystem/database directly, calls out to an LLM
  vendor, or decides whether a proposal is allowed to commit belongs in
  `src/agentic`, `src/core`, or `src/instructions` — not in any future
  client package.
- Code that touches `react`, a DOM/browser API, or a hardware/peripheral
  SDK, or that renders anything, does not belong in `xHIS-core` at all.
  Stop and flag it rather than adding it here.
- `src/agentic/ui/` is the seam, not a place for rendering logic: it
  produces a typed, validated `UiRenderOutcome` and stops there. See
  `docs/DETERMINISTIC_CORE_PATTERN.md`'s "Resolved: Generative UI as a
  third instance of the same containment pattern."
- Never let an Agentic AI proposal — instructions or UI — reach a
  `commit()` call without first passing through the validated-union
  gate and Check (`combineVerifiers`/the verification spine). See
  `docs/AGENTIC_LAYER.md` and `docs/DETERMINISTIC_CORE_PATTERN.md`.
- When a real database or a real client eventually needs wiring in,
  implement against the existing `ImperativeShell`/`UiRenderOutcome`
  seams rather than reaching into `act()`/`actHuman()`/`core/execution`
  directly — those seams exist specifically so the deterministic core
  never needs to change shape to support a new backing store or a new
  client.
