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
what make that acceptable instead of dangerous.

Saga/compensation semantics are `src/integration/patientBedSaga.ts`'s
job, layered on top rather than built into either
`reactToPatientEffects` or the relay: `reactToPatientEffectsAsSaga` wraps
one batch with all-or-nothing semantics — a `SagaPolicy` decides which
outcomes count as a real failure (not a benign redelivery no-op like
`already-assigned`), and on a real failure, every successful reaction
earlier in that same batch gets compensated in reverse (a release for
each assignment, a re-assignment for each release). This is scoped to
*one batch*, not to "every admission across all of history eventually
gets a bed" — that would be a much bigger guarantee than compensating
one transaction's own steps. The relay still advances its cursor past a
compensated batch just like an uncompensated `no-bed-available` — a
compensated batch's net effect on state is a no-op, so redelivering it
after a crash re-attempts from the same starting point rather than
compounding a partial one. The two concerns compose freely:
`relayPatientEffectsToBed` takes any reactor with `reactToPatientEffects`'s
shape, so passing a saga-wrapped one gets reliable delivery *and*
all-or-nothing batches without either mechanism knowing about the other.

The pattern here is about what has to be true *inside* one domain's
boundary before its own LLM containment holds; it says nothing about how
two already-contained domains talk to each other.

## Known boundaries: what this pattern doesn't cover yet at full HIS scale

Two domains (patient, bed) is enough to prove the pattern generalizes; it
is not enough to have actually hit every problem a full hospital
information system eventually has to solve — outpatient/inpatient/ER,
nursing, a lab system, PACS/DICOM, CDSS, remote care. The seven-step
pattern above still holds for all of these. What follows are specific,
real gaps that surface once that breadth is actually attempted, named now
so they read as known boundaries later, not as oversights.

- **Large binary objects (PACS/DICOM) don't fit a plain-JSON context.**
  Every `ExecutionContext` in this codebase is small, JSON-serializable
  data, by design (see `docs/ARCHITECTURE.md`'s determinism principle).
  An imaging study is gigabytes of pixel data — embedding it in a context
  the same way `PatientContext` embeds encounter records is wrong at any
  scale. The right shape is almost certainly the same reference-by-ID
  discipline `src/instructions/bed/ids.ts` already uses for
  `EncounterId`: the deterministic core tracks *metadata and state*
  (order placed, study performed, image stored at reference X, report
  signed), never the bytes themselves, which live in a specialized store
  referenced by ID. This hasn't needed to exist yet because nothing here
  has had a large-object domain; it needs to become a stated convention
  before one shows up, not be improvised in the moment.
- **External protocol integration is a different kind of boundary than
  choreography between two of our own domains.** `src/integration/
  patientToBed.ts` and `outboxRelay.ts` solve reacting to *our own*
  durable commit log. A lab analyzer, an imaging modality, or a remote
  monitoring device is a third party speaking its own protocol (HL7v2,
  FHIR, DICOM), that can be offline, malformed, or simply slow in ways
  our own domains aren't. The outbox pattern's *principles* — a durable
  log, a durable cursor, idempotent consumers — generalize to this; the
  specific adapters (parsing HL7 messages into validated instructions,
  for instance) do not exist and are real, protocol-specific work, not a
  variation on `patientToBed.ts`.
- **N-way choreography doesn't scale as N hand-written pairwise reaction
  modules.** One integration module for one domain pair (patient→bed) is
  fine; a real HIS has several domains all potentially reacting to each
  other. See "Event bus vs. federated subscription" below for the fuller
  reasoning — the short version is that this is deferred deliberately,
  not an oversight.
- **CDSS is not a new category — it should be treated as another Plan
  source, not a parallel system.** A clinical decision support
  recommendation and an LLM's proposal are the same *shape* of problem:
  something non-deterministic (a model, a rule engine) suggesting an
  action that has to pass through the same closed-union validation,
  Check rules, and risk-tiered approval as anything else — not a
  separate, less-rigorous path just because it "looks like" a rules
  engine instead of an LLM. This also means CDSS inherits the TFDA SaMD
  classification question `docs/AGENTIC_LAYER.md`'s Restrictions section
  already raises for the LLM planner, likely more urgently — CDSS is a
  well-established SaMD category in its own right.
- **Remote care's data volume and frequency is a different regime than
  discrete clinical events.** Continuous vitals streams from a wearable
  are high-frequency and high-volume in a way admission/discharge events
  aren't. `outboxRelay.ts`'s "read the whole commit log, process what's
  new" design has never been evaluated against that kind of load —
  scaling to it might be fine as-is or might need a different batching
  or windowing strategy. This is an open performance question, not a
  correctness one, and isn't resolved here.

## Event bus vs. federated subscription (deferred)

The "N-way choreography" boundary above deserves the fuller reasoning,
because the tempting move — build a generic event bus now — turns out to
be the same mistake this codebase has consistently avoided elsewhere.

**The hard part is already domain-agnostic; only the wrapping is
bed-shaped.** `createFileOutboxCursor` durably tracks "how far has this
one consumer gotten" against any ordered log; `readCommits` durably
produces that ordered log for any domain that uses `createFileShell`.
Nothing stops a third domain (say, nursing) from opening its own cursor
file and reading `patientCommitsFile` today — `relayPatientEffectsToBed`
just happens to be typed and named for the one reaction that exists.
What's genuinely domain-specific is only `patientToBed.ts`'s reaction
logic and its `PatientBedReactionOutcome` type — the same split as
`core/execution` being domain-agnostic while `instructions/patient`
is the concrete consumer. Building "an event bus" is really extracting
the already-generic 80% from the currently bed-shaped 20%, not inventing
new machinery.

**The real fork is centralized vs. federated, and federated wins here.**
A centralized bus — every domain publishes into one shared log — gives
free global ordering, but introduces a shared dependency every domain
must couple to, which cuts against the bounded-context discipline this
whole codebase follows (each domain owns its own closed instruction
union, its own commit log, its own risk policy). The federated
alternative — every domain keeps its own log; anyone who cares opens
their own cursor into it — adds no new shared coupling. Whoever writes
`patientToNursing.ts` someday should do the same thing
`patientToBed.ts` already does, not register with a new central broker.

**Reacting and observing are different needs and should stay different
mechanisms.** The earlier open question about whether human- and agent-
originated audit records need one merged timeline is *not* a reason to
centralize the bus — a write-time bus and a read-time query view solve
different problems. A single shared log written by every domain gives
you global order at write time, at the cost of coupling every domain to
it. A read-only tool that reads several domains' independent logs and
merge-sorts them by timestamp (or by a shared key like `encounterId`)
gets the same *observability* outcome without any domain needing to
know the tool exists. Nothing here builds that tool either, but it's
the right shape for that need, not the bus.

**N² is probably not the real shape of the problem.** Real domain
graphs tend to be sparse and hub-like, not complete — Billing might
subscribe to Patient, Lab, and Bed; Lab probably only subscribes to
Patient. Generalizing the relay saves the *reliability engineering*
(cursors, redelivery safety, idempotency reasoning) from being
rederived per pair — it was never going to save the *reaction logic*
itself, which is real, irreducible business logic that has to be
written once per relationship regardless of how generic the plumbing
underneath it is.

**Deferred on purpose — the same choice `IsoTimestamp` already faced,
and has since resolved.** `src/instructions/bed/ids.ts` once re-exported
`IsoTimestamp` from the patient domain rather than relocating it, because
one additional consumer wasn't yet a strong enough signal for where the
*right* shared home should be. That relocation has since happened —
`IsoTimestamp` now lives in `src/core/temporal.ts`, re-exported from both
domains' `ids.ts` — once the second real consumer (`bed`) made it
unambiguous the type was never patient-specific in the first place. The
event bus question is the same shape of decision at a larger scale, not
yet at the same point: with only two domains, there is still no second
real *subscription relationship* to generalize against (a type used by
two domains and a many-domain event-reaction mechanism are different
things), so a generic "subscribe to any domain's effects" abstraction
built today would be shaped by guesswork, not an actual second use.
Resolving the smaller `IsoTimestamp` case doesn't imply the bigger event-
bus case is ready to resolve the same way — the trigger is a real third
subscriber showing up, not the mere existence of a relocated type. The
design above is deliberately detailed enough that building it later
shouldn't require rediscovering this reasoning — just acting on it once
a third domain actually needs to subscribe to something.

## Resolved: the third subscriber, and what it actually proved

A third domain (`lab`, chosen over `nursing` — nursing conflates
credential/role state and roster-generation, two unrelated concerns
better tested separately, see `docs/AGENTIC_LAYER.md`) was built and
wired into the choreography specifically to stop reasoning about this
hypothetically. `src/integration/patientToLab.ts` reacts to
`EncounterDischarged` by cancelling every still-pending lab order for
that encounter, and `src/integration/outboxRelayLab.ts` relays it
through the same durable, redelivery-safe mechanism `outboxRelay.ts`
already gave bed. The predictions above held, precisely:

- **What generalized:** `readCommits`/`CommittedBatch` relocated from
  `agentic/shell/fileShell.ts` to `core/io/commitLog.ts` (re-exported
  from their old home for existing callers), and the relay loop itself —
  read the source log, ask a durable cursor where it left off, run
  `react`, commit the result *before* advancing the cursor — was
  extracted into `core/io/relay.ts`'s `relayEffects`. Both
  `relayPatientEffectsToBed` and the new `relayPatientEffectsToLab` are
  now thin bindings of it: each closes `react` over its own engine and
  whatever domain-specific inputs that reaction needs. `relayEffects`
  itself imports nothing from `bed`, `lab`, or `patient` — exactly the
  same domain-agnostic-core split `core/execution` proved twice already.
- **What didn't, and was never going to:** `patientToLab.ts`'s reaction
  logic is real, hand-written business logic, not boilerplate — and it
  is a genuinely different *shape* from `patientToBed.ts`'s, not just a
  relabeling. Bed's `EncounterAdmitted` reaction makes a one-to-one
  selection decision (`BedSelectionStrategy` picks *one* bed among
  several); lab's `EncounterDischarged` reaction is one-to-many with no
  selection at all (cancel *every* still-pending order, zero policy
  choice involved). Confirming that `BedSelectionStrategy` was never
  part of the relay's own shape — only of bed's particular `react`
  closure — is exactly what proves `relayEffects` is honestly generic
  rather than accidentally bed-shaped underneath a generic-looking
  signature.
- **What stayed federated, on purpose:** there is still no central bus,
  no registry of subscribers, and no shared "domain effect" type. Lab
  reads `patientCommitsFile` directly, exactly the way bed does, with
  its own cursor file and its own relay module. Adding lab required
  writing one new reaction module and one new ~40-line relay binding —
  not touching `outboxRelay.ts`, `patientToBed.ts`, or anything bed-
  specific at all. That is the federated model's promised property
  (a new subscriber costs a new file, not a shared-resource negotiation)
  actually holding up under a real second instance, not just a plausible
  argument for it.

Net conclusion: generalizing the outbox-relay *plumbing* across two real
consumers was worth doing and cost little (moving two files' worth of
already-generic code). Generalizing the *choreography* itself — a bus,
a subscriber registry, a shared reaction interface — would still be
solving a problem that doesn't exist yet: two relationships is not
evidence of an N² shape, and the one dimension a bus would need to
handle generically (differing reaction shapes) is precisely the
dimension that shouldn't be generic, because it's where the actual
clinical/business rules live.
