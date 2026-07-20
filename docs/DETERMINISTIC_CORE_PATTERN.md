# The deterministic core pattern: containing LLM non-determinism, not just modeling a domain

This document is not about the patient domain, and not about ERP/HRP. It
states the pattern both are instances of — the thing that has to be true
of *any* domain's foundation layer before it's safe to let an LLM propose
actions against it. [`ARCHITECTURE.md`](ARCHITECTURE.md) and
[`AGENTIC_LAYER.md`](AGENTIC_LAYER.md) are the worked example; this
document is what to extract from that example before building a second
one (an ERP/HRP core, or anything else).

## The thesis

A deterministic foundation layer's most important job is not "modeling
the domain correctly." It's making an LLM's hallucination and non-
deterministic output **structurally incapable of reaching committed,
consequential state** — regardless of what domain-specific correctness
property that state has to uphold.

Two domains can have completely different "hard cores" — the clinical
core's invariant is state/timing precision plus regulatory traceability;
an ERP/HRP core's invariant would be conservation of assets and equity
(double-entry balance, quantities that can't be created or destroyed
without an accounted-for transaction) — and still be instances of the
*same* containment pattern. What varies is the domain-specific invariant
being protected. What doesn't vary is the shape of the pipeline that
protects it.

## The pattern

Every domain that wants to let an LLM propose actions against it needs
all of the following, in order. Skipping a step doesn't make the system
faster — it makes the containment boundary have a hole in it.

1. **A closed, compiler-provable action union.** Every action the domain
   can take is a member of one discriminated union, checked exhaustively
   at compile time (a total handler/validator registry, proven by a
   `__typetests__`-style `@ts-expect-error` gap check — not prose, not a
   runtime `if`). Nothing outside this set can exist as a typed value.
2. **A hard validation boundary between untrusted output and a typed
   domain object.** An LLM's raw output is text/JSON, not yet trusted,
   until every field of every proposed action has been checked against
   the closed union from step 1. A response that doesn't validate never
   becomes a domain object — not a degraded one, not a partial one, none
   at all.
3. **A domain-specific invariant proof**, applied to what step 2
   produced. This is the one step whose *content* is different per
   domain — a clinical core proves the resulting state is a pure,
   deterministic function of the instructions applied to it; a ledger
   core would instead have to prove every produced transaction balances
   (debits equal credits, quantities conserved) before it's eligible to
   commit. The proof mechanism doesn't have to be the type system — a
   low-tech, CI-enforced runtime check (in the same spirit as this
   codebase's determinism guard) is legitimate, as long as it's a check
   something actually runs, not a comment asking developers to remember.
4. **Business/compliance rules, combined by severity, never weakening
   each other.** Multiple independent rules (batch-size sanity, PDPA-
   style data-handling checks, domain-specific business rules) each
   produce a decision; combining them can only ever raise the outcome
   toward more scrutiny, never lower it below what any single rule
   already required.
5. **A risk-tiered, identity-bound human approval gate before anything
   consequential commits.** Not every action needs a human, but the
   system — not the LLM — decides which ones do, via a compile-time-
   total mapping from action kind to risk tier. And "a human approved
   this" must mean a real, permission-checked identity, not a free-form
   string the caller could set to anything — checked identically for an
   approval and a decline, since an unauthenticated "no" is exactly as
   exploitable as an unauthenticated "yes."
6. **Deterministic, replayable execution, with commits and audit
   entries as two separate obligations.** The step that actually applies
   state changes is the only place real I/O happens, commits only on an
   accepted/approved decision, and writes exactly one audit record
   *regardless of outcome* — rejection and pending approval get recorded
   too, with nothing applied.
7. **Provenance that survives the pipeline.** Which model, which prompt
   version, whose rationale, whose approval, under what role, decided at
   what time — stamped into the audit record, not reconstructed after
   the fact from logs that may or may not still exist.

## What this looks like, instantiated once

| Pattern step | Patient domain instantiation |
|---|---|
| 1. Closed action union | `PatientInstruction`, `HandlerRegistry`, `RiskTierRegistry`, `InstructionValidatorRegistry` — three separate total mappings over the same closed union, each proven exhaustive independently |
| 2. Validation boundary | `validation/validator.ts` + `toPlanProposal()` — a `RawPlanOutput` never becomes a `PlanProposal` without passing per-instruction validation |
| 3. Domain invariant proof | The determinism guard (`tests/instructions/patient/determinism.guard.test.ts`) plus `executeSequence`'s all-or-nothing batch contract — the clinical core's invariant is exact replay, not balance |
| 4. Combined business/compliance rules | `combineVerifiers()` — PDPA rationale scan, batch-size rule, risk-tier lookup, merged by severity (`reject` > `needs-human-approval` > `accept`) |
| 5. Risk-tiered, identity-bound approval | `RiskTierRegistry` + `ApprovalPolicy` + `resolveApprovalForProposal()` — an `Approval` only exists once a real `IdentityProvider` has confirmed the claimed identity holds a required role |
| 6. Deterministic commit + audit | `act()` against an `ImperativeShell` — `createFileShell` for real persistence, one `AuditRecord` written on every outcome |
| 7. Provenance | `PlanProposal.modelVersion`/`promptVersion`/`rationale`, `Approval.approverId`/`approverRole`/`decidedAt`, all stamped into `AuditRecord` |

None of this is domain-specific *as a shape*. Swap step 3's proof
obligation from "exact replay" to "double-entry balance," swap
`PatientInstruction` for a `LedgerInstruction` union, and the rest of the
table's structure holds — the code wouldn't, and shouldn't, be shared,
but the checklist would.

## Using this for the next domain

Before any new domain (ERP/HRP or otherwise) gets its own agentic layer,
it should be able to fill in its own version of the table above — in
particular, it needs to have actually decided what step 3's invariant
*is* and how it's proven, not skip straight to reusing steps 1, 2, 4–7
and hoping step 3 works itself out. A domain that can't state its own
"determinism guard equivalent" in one sentence isn't ready for an LLM to
propose actions against it yet.

Cross-domain integration (e.g. a clinical `EncounterAdmitted` effect
triggering an ERP-side ledger entry) is a separate concern this document
deliberately doesn't cover — that's a choreography-vs-orchestration
question with its own failure modes, not something resolved by containing
non-determinism within either domain individually. `src/integration/
patientToBed.ts` is the first concrete instance — `EncounterAdmitted`
triggering `AssignBed`, and `EncounterDischarged` triggering `ReleaseBed`
by looking up whichever bed is currently on record for that encounter.
Reacting directly (`reactToPatientEffects`) is still in-process and
synchronous, not durable messaging on its own. `src/integration/
outboxRelay.ts` is what actually closes the "missed event silently
breaks a domain's invariant" failure mode: it reads the patient domain's
durable commit log instead of reacting to effects in memory, tracks how
far it's gotten with a durable `OutboxCursor` (`src/core/io/outboxCursor.ts`),
and commits each entry's bed effects *before* advancing the cursor past
it — so a crash between the two just means that entry gets redelivered on
the next run, never silently dropped. That guarantee only holds because
`reactToPatientEffect`'s `EncounterAdmitted` case checks for an existing
assignment before selecting a bed, making redelivery safe rather than
merely possible; delivery is at-least-once, and idempotent reactions are
what make that acceptable instead of dangerous. What's still not
implemented is saga/compensation semantics: nothing rolls back an
admission that got no bed, and nothing guarantees one eventually will —
the cursor advances past a `no-bed-available` outcome too, deliberately,
so one stuck entry can't block every later one behind it.
The pattern here is about what has to be true *inside* one domain's
boundary before its own LLM containment holds; it says nothing about how
two already-contained domains talk to each other.
