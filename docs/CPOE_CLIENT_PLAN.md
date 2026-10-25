# Plan: server API + first physician-facing CPOE screen

Status: **proposal, nothing built.** Written from a read of the code on
`master` (post-#58), not from running a prototype. It extends
[`HYBRID_ARCHITECTURE_ALIGNMENT.md`](HYBRID_ARCHITECTURE_ALIGNMENT.md),
whose conclusion was "no client code exists yet; here are the seams to
build against." This document picks those seams and orders the work.

## What exists today (verified)

- **Write path for a human physician:** `actHuman()` (`src/human/actHuman.ts`)
  takes instructions plus an already-resolved authorization, re-executes
  against `shell.readLatest()` (optimistic concurrency), commits through
  an `ImperativeShell`, and writes an audit record. Authorization comes
  from `resolveActorForInstructions()` (role check via `IdentityProvider`
  + `RiskTierRegistry` + `ApprovalPolicy`).
- **CPOE domain:** `outpatient` (`CheckInPatient`, `RecordSoapNote`,
  `FinalizeSoapNote`, `PlaceCpoeOrder`, `CompleteEncounter`). A CPOE order
  carries `orderType: lab | imaging | pharmacy` and is relayed to those
  domains by `integration/outpatientTo*.ts` + outbox relays.
- **Durable store:** `@xhis/postgres-shell` — a real multi-writer
  `ImperativeShell` (tenant RLS + `UNIQUE(tenant_id, version)` OCC).
- **UI seam:** `agentic/ui/*` — typed, validated `UiRenderOutcome`
  (`render | fallback`). It describes *what* to show; it renders nothing.
  Note: the existing components (e.g. `ApprovalConfirmationPanel`) cover
  the **AI-proposal approval** flow, not a physician composing an order.
- **Only interactive surface:** `scripts/roleplay-cli.mjs` (a demo).

## Gaps found while reading (these shape the plan)

1. **No HTTP/API layer anywhere.** Nothing accepts a request from a client.
2. **Clinical domains are not in `@xhis/core`'s public export**
   (`src/index.ts` exports the engine/shell/identity machinery, not
   `outpatientEngine`, `actHuman`, or the outpatient validators/risk
   tiers). `roleplay-cli.mjs` works around this by deep-importing
   `packages/xhis-core/dist/...`. `CLAUDE.md` forbids that for any
   sibling package, so a new API package **cannot** be built cleanly
   until this is resolved (see Decision 1).
3. **No read model.** The context is plain JSON (`OutpatientContext`), so
   a screen *can* be fed from `readLatest()`, but there is no query API
   (patient list, an encounter's orders, order status after relay).
4. **No authentication.** `IdentityProvider` resolves an asserted actor
   id to roles; nothing yet establishes who the caller really is (session,
   token). The API must not trust a client-supplied actor id.
5. **No "physician composes an order" UI component.** The UI seam would
   need one new descriptor family, or the client builds this form itself
   (it is local input, not an Agent-selected component — see Decision 3).

## Decisions needed before building

1. **How the API reaches the clinical domains.** Options:
   - (a) The API is a new sibling package that, like `roleplay-cli`,
     imports domain pieces by deep path. Violates the guardrail; only
     acceptable if `CLAUDE.md`/guard are deliberately amended.
   - (b) Add a *second, explicit* public entry point to `@xhis/core`
     (e.g. `@xhis/core/clinical`) exporting the example domains +
     `actHuman`. Keeps the one-way dependency rule and keeps domains out
     of the domain-agnostic root export. **Recommended.**
   - (c) Put the API inside `packages/xhis-core`. Rejected: breaks the
     "no HTTP framework under `src`" CI guard.
2. **Auth.** Start with a stub that maps a signed session/token to an
   `actorId`, feeding the existing `IdentityProvider`; real SSO is later
   work. Never accept `actorId` from the request body.
3. **Who owns the order-entry form.** Recommended: the client owns it
   (guardrail 2: local input pre-validation), and the server re-validates
   with the existing `outpatientInstructionValidators`. The Agent-driven
   `UiRenderOutcome` path is reserved for AI proposals (e.g. showing a
   CDSS suggestion for the physician to accept).

## Proposed shape

```
packages/
  xhis-core/      (unchanged shape; + clinical entry point, Decision 1b)
  postgres-shell/ (unchanged)
  xhis-api/       NEW  server: HTTP + auth + read model, thin
  xhis-client/    NEW  client: physician UI (React), renders only
```

`xhis-api` is a thin adapter, no domain logic:

| Endpoint | Does |
|---|---|
| `GET /encounters?status=checked-in` | read model from `readLatest()` |
| `GET /encounters/:id` | encounter + SOAP notes + orders |
| `POST /encounters/:id/orders` | validate → `resolveActorForInstructions` → `actHuman({PlaceCpoeOrder})` |
| `POST /encounters/:id/soap-notes` (+ `/finalize`) | same pipeline |
| `GET /proposals/:id`, `POST /proposals/:id/decision` | AI proposal approve/reject via existing `act()` + `UiRenderOutcome` |

Mapping of `actHuman` outcomes to HTTP: `committed` → 201,
`unauthorized` → 403, `rejected` → 409/422 with the typed
`OutpatientError`, OCC conflict → 409 + client refetch.

## Build order (each step independently mergeable, `verify` green)

1. **Clinical export seam** (Decision 1b) + extend the architecture
   guard so the new entry point is the *only* sanctioned path.
2. **`xhis-api` skeleton**: server, config, health check, in-memory
   shell wiring; extend the boundary guard so HTTP frameworks are
   allowed in this package but still banned in `xhis-core`.
3. **Read endpoints** over `readLatest()`; contract tests.
4. **`POST …/orders`** end to end against Postgres (reuse the
   `postgresShellIntegration` test support), including the stale-commit
   and unauthorized paths.
5. **`xhis-client` skeleton + first screen:** pick a checked-in
   encounter → compose a lab order → submit → show committed/rejected
   and, later, relayed status. Lab first (smallest payload: `testCode`).
6. Imaging + pharmacy orders, then SOAP note screen.
7. AI-proposal approval screen using the existing `UiRenderOutcome`.

## Explicitly out of scope for now

Real SSO, offline cache, hardware bridges (IC card, barcode, printer),
dictation/ambient edge assistants, order cancellation/amendment (the
domain itself doesn't model them yet), and any visual design system.

## Risks

- Order-status feedback to the physician depends on the outbox relay
  running; the API needs a way to show "placed, not yet received by lab".
- CPOE is high-stakes: the UI must show the server's rejection reasons
  verbatim and never optimistically display an order as placed.
