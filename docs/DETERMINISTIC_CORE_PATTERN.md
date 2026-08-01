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

Two domains can have completely different "hard cores" and still be
instances of the *same* containment pattern. Three families of "hard
core" are named throughout this document, and each is what the
domain-specific step 3 below has to actually prove:

- **State/time-precision plus regulatory traceability** — the clinical
  core's invariant: resulting state must be an exact, replayable
  function of the instructions applied to it, with a compliance-grade
  audit trail.
- **Conservation** — an ERP/ledger core's invariant: assets and equity
  balance (double-entry, quantities that can't be created or destroyed
  without an accounted-for transaction).
- **Optimization/feasibility** — an OR-scheduling or roster-generation
  core's invariant: proposed assignments are *feasible* (no resource
  double-booked, no hard constraint violated), independent of whether
  they are *optimal*.

What varies is the domain-specific invariant being protected. What
doesn't vary is the shape of the pipeline that protects it.

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

**This paragraph was written before that swap was actually made — see
"Resolved: the conservation family" below for what happened once it
was.**

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

**This section was written when only patient and bed existed.** Every
domain and benchmark built since has tested most of what's named
below — each bullet is left as originally written, not quietly
rewritten, with a pointer added to whatever later section resolved it.

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
  before one shows up, not be improvised in the moment. See "Resolved:
  large binary objects (PACS/DICOM reference-by-ID)" below for that
  convention actually built and tested, not just proposed here.
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
  variation on `patientToBed.ts`. See "Resolved: message-ID idempotency
  for external protocol integration" below for the one mechanism inside
  this boundary that turned out to be worth testing, and for why the
  rest of it — the parsing, the connection liveness — deliberately
  wasn't.
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
  well-established SaMD category in its own right. See "Resolved: CDSS
  as a Plan source" below for a second, non-LLM planner actually built
  to check this claim against, rather than just asserting it.
- **Remote care's data volume and frequency is a different regime than
  discrete clinical events.** Continuous vitals streams from a wearable
  are high-frequency and high-volume in a way admission/discharge events
  aren't. `outboxRelay.ts`'s "read the whole commit log, process what's
  new" design has never been evaluated against that kind of load —
  scaling to it might be fine as-is or might need a different batching
  or windowing strategy. This is an open performance question, not a
  correctness one, and wasn't resolved *here* — see "Resolved: remote
  care data volume (benchmarked)" below for the measurement that
  replaced "might be fine as-is" with an actual number.

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

**"Nursing" above was an arbitrary placeholder name, not a forecast.**
The two mentions of nursing in this section (as an example third
subscriber, and as the module that might someday write
`patientToNursing.ts`) were written before nursing was an actual
domain — any name would have done as the example. The nursing domain
that was later built (see "Resolved: nursing's credential/role state,
split from roster generation") never became a patient-choreography
consumer at all: it has no relationship to `patientCommitsFile`, no
`patientToNursing.ts`, and nothing to do with subscribing to anything.
Read "nursing" above as it was meant at the time — an arbitrary example
— not as something that came true under that name.

## Resolved: the third subscriber, and what it actually proved

A third domain (`lab`, chosen over `nursing` — nursing conflates
credential/role state and roster-generation, two unrelated concerns
better tested separately, see "Resolved: nursing's credential/role
state, split from roster generation" below for what nursing actually
turned out to be once it was built) was built and
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

## Proposed: a federated choreography spine for verification, not just domain reactions

Everything above generalizes *domain* choreography — one domain's
committed effect becoming another domain's instruction, via a durable
log, a durable cursor, and an idempotent reaction. Check (Plan →
`combineVerifiers` → Act) has never needed that treatment, because
every verifier written so far (`batchSizeRule.ts`, `riskTierVerifier.ts`,
`pdpaRules.ts`) is a pure, synchronous, in-process function —
`combineVerifiers` runs all of them inline, before Do or Act ever see
the proposal, and that has been fine because none of them are slow.

That stops being fine the moment a "verification harness" means
calling out to something slow or non-local: an external compliance
service, a second LLM acting as a safety reviewer, a queued
human-review step distinct from the `needs-human-approval` approval
flow `act()` already has. Blocking Plan's next proposal on that call —
the only option `combineVerifiers`' synchronous contract allows today —
would make generation throughput hostage to whatever the slowest
plugged-in harness happens to be. This section proposes closing that
gap the same way the domain-choreography question above was
eventually closed: **don't call it in-process — durably log it, and
let independent consumers react on their own schedule.** Nothing here
is built yet; this is a design to build against, in the same spirit as
"Event bus vs. federated subscription" above was a design to defer
against until a real third subscriber existed.

**The core move.** Plan's only synchronous obligation becomes
appending one proposal to a new, append-only `ProposalLog` — the same
cost class as any other commit, and the same shape as the
`CommittedBatch` log every domain already keeps via `createFileShell`.
Each verification harness becomes its own cursor-tracked consumer of
that log, exactly the way `patientToLab.ts` and `patientToBed.ts` are
each their own independent cursor-tracked consumer of
`patientCommitsFile` today. Adding, removing, or slowing down one
harness never touches Plan or any other harness — the identical
"federated, no new shared coupling" property "Resolved: the third
subscriber" above proved for domain reactions, applied one layer up to
verification itself.

**Event schema.** No new envelope is needed for the source side — it's
the same `CommittedBatch<TCtx, TEffect>` `relay.ts` already reads. What's
new is the proposal log, deliberately shaped the same way:

```ts
export type ProposalId = Brand<string, 'ProposalId'>;

export interface ProposalEnvelope<TInstruction extends Kinded> {
  readonly proposalId: ProposalId;
  readonly proposal: PlanProposal<TInstruction>;
  readonly loggedAtTick: Tick; // position in this log — not a timestamp
}

export interface ProposalLog<TInstruction extends Kinded> {
  append(proposal: PlanProposal<TInstruction>): ProposalId;
  readSince(fromTick: Tick): readonly ProposalEnvelope<TInstruction>[];
}
```

`loggedAtTick` is exactly the case `Tick` (`core/temporal.ts`) was
added for — a worker's cursor position is a logical sequence number
into this log, never a clock read.

**State transitions.** `VerifyDecision`'s "severity only accumulates"
rule (`verifier.ts`, folded today by `combineVerifiers.ts`'s
`mergeDecisions` — `reject` beats `needs-human-approval` beats
`accept`, same-severity reasons merge rather than one arbitrarily
winning) is already a state machine; it has just only ever been run
across verdicts that all arrive in one synchronous call. The proposed
`VerificationState` folds the identical rule across verdicts arriving
at different times, by reusing `mergeDecisions` rather than
reimplementing it:

```ts
export type VerificationState =
  | { readonly kind: 'pending'; readonly reportedBy: readonly WorkerId[] }
  | { readonly kind: 'resolved'; readonly decision: VerifyDecision };
```

A `reject` from any one worker resolves the proposal immediately,
without waiting for the rest to report — the same latency win
`needs-human-approval` already gets today from `mergeDecisions`'
"severity only accumulates," realized across time instead of within
one call.

**Contract boundary interfaces.** Three interfaces, each sized like
the existing `EffectCommitter`/`OutboxCursor` (`relay.ts`), not a new
framework:

```ts
/** Any existing synchronous Verifier trivially satisfies this —
 *  returning a Promise is the only thing a slow harness needs to add. */
export interface VerificationWorker<TInstruction extends Kinded> {
  readonly workerId: WorkerId;
  verify(proposal: PlanProposal<TInstruction>): VerifyDecision | Promise<VerifyDecision>;
}

export interface VerificationRecordStore {
  record(proposalId: ProposalId, workerId: WorkerId, decision: VerifyDecision, verifiedAt: IsoTimestamp): void;
  readAllFor(proposalId: ProposalId): readonly { workerId: WorkerId; decision: VerifyDecision }[];
}

/** The verification-side counterpart to relayEffects — same shape:
 *  cursor-tracked, redelivery-safe, one worker per cursor. */
export function runVerificationWorker<TInstruction extends Kinded>(
  worker: VerificationWorker<TInstruction>,
  proposalLog: ProposalLog<TInstruction>,
  cursor: OutboxCursor,
  recordStore: VerificationRecordStore,
  verifiedAt: IsoTimestamp,
): Promise<void>; // same loop shape as relayEffects, a verdict instead of an effect
```

What's conspicuously *not* in this list: any change to `act()` or
`actHuman()`. A scheduler calls `act()` exactly when
`VerificationState` reaches `resolved` — that is the same "call
`act()` again later, once an `Approval` arrives" flow `act()` already
implements for `needs-human-approval` (`act.ts`). The new machinery
only decides *when* `act()` gets called; it changes nothing about how
`act()` decides once called.

**Why this doesn't fight the hardening already proven this session.**

- **Idempotency is free here**, unlike `reactToPatientEffect`'s
  bed-assignment case (`patientToBed.ts`, which needs an explicit
  existing-assignment check before selecting a bed, for exactly this
  reason). `Verifier.verify` is already required to be pure with no
  side effects; a worker re-verifying the same proposal after a
  crash-and-redeliver just recomputes the same answer. No equivalent
  guard is needed.
- **Staleness risk goes up, but the fix already exists.** A longer
  pending-verification window means more time for the world to move
  between Do's dry run and Act's commit. `act()`'s
  `commitAfterFreshCheck` — re-deriving Do against
  `shell.readLatest()` immediately before commit, the OCC fix this
  session already made and proved with
  `tests/agentic/shell/actStaleCommitRace.test.ts` — already covers
  this regardless of how long Check took to resolve. This design makes
  that mechanism carry more weight; it needs no new one.
- **Nothing forces migration.** Fast, synchronous verifiers can keep
  going through `combineVerifiers` inline exactly as today. This is
  additive infrastructure for harnesses that are actually slow, not a
  rewrite of the ones that aren't — the same "deferred until a real
  need, not built on guesswork" discipline "Event bus vs. federated
  subscription" above already applied to domain choreography.

**What would turn this from proposed to resolved**, mirroring
"Resolved: the third subscriber" above: a first real
`VerificationWorker` — wrapping the existing `batchSizeRule` verifier
unchanged, proving the adapter direction (sync `Verifier` → async-
capable `VerificationWorker`) actually costs nothing — running against
a real `ProposalLog`, with a test that simulates a lost cursor and
confirms no pending proposal is ever lost or gets a conflicting
recorded verdict, the same proof `outboxRelayStaleCommitRace.test.ts`
already gave the domain-choreography side of this pattern. See
"Resolved: the first VerificationWorker, wrapping batchSizeRule" below
for that slice, actually built.

## Resolved: the first VerificationWorker, wrapping batchSizeRule

The first slice above was built exactly as scoped:
`src/agentic/verification/proposalLog.ts` (`ProposalId`,
`ProposalEnvelope`, `ProposalLog`, `createFileProposalLog`) and
`src/agentic/verification/verificationWorker.ts` (`VerificationWorker`,
`VerificationRecordStore`, `verifierAsWorker`, `runVerificationWorker`),
proven by `tests/agentic/verification/proposalLog.test.ts` and
`tests/agentic/verification/verificationWorker.test.ts`.

- **The adapter direction costs nothing, confirmed rather than assumed.**
  `verifierAsWorker` wraps `createMaxBatchSizeVerifier` with no change to
  its behavior — the recorded verdicts for an under-limit and an
  over-limit proposal match exactly what `combineVerifiers` would have
  produced synchronously (`accept` and `needs-human-approval` with the
  identical `reasons` string), just arrived at through a durable log and
  a cursor instead of one inline call.
- **One correction the design section above got slightly wrong, caught
  by writing the test rather than by re-reading the prose.** The
  "what would turn this from proposed to resolved" paragraph originally
  asked for a test confirming a redelivered proposal is "neither lost
  nor double-recorded." That's not quite the actual property, and this
  document is being corrected rather than left overstating it: a
  redelivered proposal (simulated the same way
  `outboxRelay.test.ts`'s "safely redelivers an already-processed
  admission" test does — a fresh cursor pointed at the same log, as if
  the real cursor's advance never made it to disk) *does* get a second
  record. What redelivery actually guarantees, and what
  `verificationWorker.test.ts`'s equivalent test proves, is that the
  second record is never lost (it exists) and never *conflicting* (it
  carries the identical decision) — because `Verifier.verify` is pure,
  not because recording is deduplicated. This is the same "delivery
  guarantee, not a success or uniqueness guarantee" `relayEffects`
  itself already documents, just re-derived here for verdicts instead of
  effects. `runVerificationWorker`'s own doc comment states this
  precisely so the next reader doesn't have to rediscover it from the
  test.
- **`VerificationState`/`foldVerdict` — the piece that folds possibly-
  duplicate, possibly-still-`pending` records into one `VerifyDecision`
  — is deliberately not part of this slice.** This slice only had to
  prove `ProposalLog` and `VerificationWorker` are sound building blocks
  (durable, redelivery-safe, behavior-preserving for an existing
  `Verifier`); folding records into a decision `act()` can consume is
  real, separate work, correctly deferred the same way `patientToLab.ts`'s
  reaction logic was correctly deferred until `relayEffects` itself was
  proven generic first.

## Resolved: VerificationState and foldVerdict

The deferred piece from the section above is now built:
`src/agentic/verification/verificationState.ts`'s `VerificationState`,
`foldVerdict`, and `resolveVerificationState`, proven by
`tests/agentic/verification/verificationState.test.ts` — including an
end-to-end test running two real `VerificationWorker`s (different
`createMaxBatchSizeVerifier` limits) through `ProposalLog` and
`VerificationRecordStore`, then confirming `resolveVerificationState`
folds their recorded verdicts to the *exact* decision `combineVerifiers`
would have produced from the same two verifiers called synchronously,
inline, on the same proposal. That equivalence — not just "it compiles
and folds something" — is the actual claim this slice had to prove:
folding asynchronously-arrived records has to reach the same answer
Check already reaches today, or the whole point of decoupling Plan from
Check would be an observable behavior change, not just a latency one.

- **The original sketch was missing a field, caught by trying to
  implement it, not by re-reading the prose.** "Proposed" above sketched
  `pending` as `{ kind: 'pending', reportedBy: WorkerId[] }` — no running
  decision, only who has reported. That loses information: if an early
  worker reports `reject` and a later one reports `accept`, folding
  `accept` in next with nothing tracking the `reject` would silently
  downgrade the decision the moment the second verdict arrived. The
  actual `pending` variant carries `accumulated: VerifyDecision` — the
  most severe decision folded in so far, `{ kind: 'accept' }` before
  anything has reported — precisely so `mergeDecisions`'s "severity only
  accumulates" guarantee holds across time, not just within one
  `combineVerifiers` call.
- **Redelivery-safety from the previous slice had to be threaded through
  here too, not just proven once and assumed to keep holding.**
  `runVerificationWorker` can produce a second record from the same
  worker for the same proposal after a lost cursor (proven, not just
  claimed — see "Resolved: the first VerificationWorker" above).
  `foldVerdict` handles this two ways, both tested directly: a worker
  already present in `reportedBy` is never counted twice toward
  `requiredWorkers`, so a duplicate record can't make a proposal resolve
  before every *distinct* required worker has actually weighed in; and
  folding an identical verdict into an already-`resolved` state is a
  no-op, checked first, before any merge happens at all — an
  already-terminal decision never gets recomputed, let alone changed, by
  a redelivered duplicate arriving late.
- **One deliberate deviation from `combineVerifiers()`'s own precedent,
  added rather than merely inherited.** `combineVerifiers()` accepts
  everything when given zero verifiers — a `resolveVerificationState`
  call with zero `requiredWorkers` mirrors that (`{ kind: 'resolved',
  decision: { kind: 'accept' } }` immediately, ignoring `records`
  entirely). Without this guard, misconfiguring a proposal with no
  required workers at all would leave it `pending` forever, since
  nothing would ever call `foldVerdict` on it — a real footgun for
  whoever wires up the first scheduler, closed here rather than left for
  them to discover.
- **What's still deliberately not built:** the scheduler itself — the
  thing that actually polls `resolveVerificationState` and calls `act()`
  the moment it returns `resolved`, the way `act()`'s own
  `needs-human-approval` flow already expects to be called again later.
  Nothing about `act()`/`actHuman()` needed to change for any of this,
  exactly as "Proposed" above predicted; that prediction has now been
  checked against two real slices, not just asserted once.

## Resolved: the scheduler, closing the loop from Plan to Act

`src/agentic/shell/scheduler.ts`'s `runScheduler` is the piece every
prior slice deferred: for every proposal in a `ProposalLog` not yet
acted on, fold its recorded verdicts via `resolveVerificationState`, and
call `act()` exactly once the moment that reaches `resolved`. Proven by
`tests/agentic/shell/scheduler.test.ts`, including an end-to-end run
against the real file-backed `ProposalLog`/`VerificationRecordStore`.
`act()`/`actHuman()` needed zero changes, exactly as predicted three
times now (in "Proposed" above, and again in each of the two slices that
followed it) — the prediction, not just the code, is what this section
closes out.

- **`act()`/`actHuman()`'s doc comments already described the exact call
  the scheduler needed to make; nothing new had to be invented.**
  `doOutcome = engine.executeSequence(shell.readLatest() ?? initialContext, proposal.instructions)`,
  `reexecute` closing over the same instructions, `decision` supplied by
  `resolveVerificationState` instead of a synchronous `combineVerifiers`
  call — every piece already existed as a documented convention
  (`tests/agentic/shell/act.test.ts` shows the identical call shape); the
  scheduler's only real job is deciding *when* to make it.
- **A real design question the doc sketch hadn't settled: is
  "already acted" a cursor or a membership set — and this had to be
  proven, not assumed, the same way the previous two slices' corrections
  were.** Each `VerificationWorker` processes `ProposalLog` entries
  strictly in order, but different workers advance at different paces,
  and `foldVerdict` short-circuits to `resolved` on any single `reject`
  without waiting for the rest of `requiredWorkers`. Concretely: a fast
  worker can reject proposal 5 (resolving it immediately, no quorum
  needed) while a slow worker hasn't reported on proposal 3 at all yet
  (still `pending`) — resolution order does not have to match log order.
  `tests/agentic/shell/scheduler.test.ts`'s "acts on a later proposal
  that resolves before an earlier still-pending one" constructs exactly
  this and confirms proposal 5 is acted on immediately while proposal 3
  is correctly left for a later poll, never skipped and never blocking
  proposal 5. A monotonic cursor cannot represent "5 is done, 3 is not";
  `SchedulerActedStore` is therefore a durable membership set keyed by
  `ProposalId`, the identical shape and the identical justification
  `integration/externalMessageIdempotency.ts`'s `MessageIdempotencyStore`
  already established for a different problem with the same root cause —
  "already handled" has to key off identity, not off a position in a log
  we don't fully control the ordering of.
- **Acting exactly once per proposal regardless of which `CommitOutcome`
  comes back is a deliberate scope boundary, not a gap.**
  `'awaiting-approval'` means a human resolves this later through the
  *separate* approval-arrives-so-call-`act()`-again flow `act()` already
  supports (`resolveApproval.ts`); this scheduler polling it again itself
  would be a second, redundant path to the same outcome, not a missing
  feature. `'stale'` means the world moved since verification, and
  `act()`'s own `CommitOutcome` doc comment already requires the caller
  to re-propose against current state rather than retry the same
  proposal unchanged — marking it acted-and-done is what fulfills that
  requirement, not a shortcut around it. Retrying either case inside this
  polling loop was considered and rejected for these reasons, not simply
  left unbuilt.

## Resolved: a genuinely async VerificationWorker, proven non-blocking

Every `VerificationWorker` built across the three slices above wraps a
*synchronous* `Verifier` (`verifierAsWorker` around `batchSizeRule`) —
proving the adapter direction cost nothing, but never actually
exercising the one branch this whole design exists for:
`VerificationWorker.verify`'s `Promise<VerifyDecision>` return type. This
slice closes that gap. `src/agentic/verification/externalVerificationWorker.ts`'s
`ExternalVerificationFn` and `createExternalVerificationWorker` adapt a
genuinely slow, external call — same "no vendor SDK, no model name"
narrowness `planning/llmPlanner.ts`'s `CompletionFn` already applies to
the equivalent problem on the Plan side — proven by
`tests/agentic/verification/externalVerificationWorker.test.ts`.

- **The claim this design has made three times without testing it was
  finally checked directly, with a controlled promise instead of a real
  timer.** A `createDeferred()` helper hands the test its own `resolve`
  function, so "the external check is still in flight" is a real,
  observable state the test can hold open for as long as it wants — no
  `setTimeout`, no flakiness, no slow test. While that promise is
  deliberately left unresolved: a second proposal appends to the same
  `ProposalLog` immediately (nothing about `append` ever had a reason to
  block, but this is now demonstrated, not just true by inspection of
  the type signature), and `resolveVerificationState` reports the first
  proposal as genuinely `pending` — not a false `accept` nobody actually
  computed. Only after the test calls `resolve` does awaiting
  `runVerificationWorker` complete and the record land.
- **The scheduler's behavior under a slow harness needed the same proof,
  not an inference from the scheduler already being correct for
  synchronous workers.** A second test runs `runScheduler` while the
  same external check is still pending: it acts on nothing, commits
  nothing, marks nothing acted — then, the instant the promise resolves
  and the worker's record lands, the very next poll commits. Nothing
  about `runScheduler` needed to change for this; it was already
  written generically enough. The value of this test is confirming
  that, not assuming it.
- **What this deliberately didn't decide yet: what happens when the
  external call fails, not just when it's slow.** `ExternalVerificationFn`
  returns `Promise<VerifyDecision>` — a rejected promise (a network
  failure, a timeout, a malformed response) had no defined handling
  anywhere in this chain at the time this slice was written; it would
  have propagated out of `runVerificationWorker`'s `await` as an
  unhandled rejection. See the follow-up immediately below for how this
  was actually resolved, once "fail safe to `needs-human-approval`" had
  a concrete design to check against rather than being guessed at in
  the abstract.

**Follow-up: a failing `verify()` call is fail-safe, not crash-prone —
and never blocks a later proposal behind it.** `runVerificationWorker`
now wraps every `worker.verify` call (`verifySafely`, in
`verificationWorker.ts`) so a thrown or rejected error folds into a
`needs-human-approval` decision — carrying the worker's ID and the
error message in `reasons` — instead of crashing the loop. `reject` was
considered and rejected for this: the proposal itself was never actually
found to be wrong, only the *check* failed to run, and `reject` would
misrepresent that in the audit trail. The cursor still advances past the
failing entry exactly as if it had recorded a normal verdict — the same
move `reactToPatientEffects` already makes for `no-bed-available`/
`reaction-failed`, and for the identical reason: holding the cursor back
to retry automatically would leave *every later* proposal unverified by
this worker for as long as the failure persists, which is worse than
surfacing the failure and moving on.
`tests/agentic/verification/verificationWorker.test.ts`'s "a failing
`verify()` never crashes the loop or blocks a later proposal" describe
block proves both halves directly: a rejecting worker gets a
`needs-human-approval` record instead of crashing the run, and — mirroring
`tests/integration/outboxRelay.test.ts`'s "advances the cursor even when
a reaction cannot be applied, so one stuck entry does not block later
ones" — a worker that fails on the first proposal in a batch still
successfully verifies the second one in the same run.

## Resolved: the patient domain, Checked through the spine — proven equivalent, not just plumbed together

Every slice above proved the spine's machinery correct in isolation —
synthetic `createMaxBatchSizeVerifier` limits, a controlled deferred
promise standing in for a real harness. None of them ran the actual
production Check assembly a real domain uses. This slice does:
`src/agentic/verification/patient.ts` gains `patientVerificationWorkers`
— the same three verifiers `patientVerifier` already combines
(`createRationalePiiScanVerifier`, `createMaxBatchSizeVerifier`,
`createRiskTierVerifier`), each wrapped by `verifierAsWorker` into its
own independent worker, instead of one direct `patientVerifier.verify`
call. `patientVerifier` itself is unchanged — both coexist, the same
"nothing forces migration" principle "Resolved: a genuinely async
VerificationWorker" already established. Proven by
`tests/agentic/planning/cdssPlanningThroughVerificationSpineEndToEnd.test.ts`,
run against the same CDSS-sourced proposals
`cdssPlanningEndToEnd.test.ts` already exercises through the direct
path.

- **The actual claim to prove was equivalence, not just "it runs."**
  Decoupling Check from Plan is only safe if it reaches the *identical*
  decision the direct, synchronous path already reaches — otherwise
  this would be an observable behavior change disguised as a latency
  one. Every test in this slice computes `patientVerifier.verify(proposal)`
  inline first, then separately runs the same proposal through all
  three `patientVerificationWorkers` plus `resolveVerificationState`,
  and asserts the two decisions are `toEqual` each other — for an
  outright `accept` (empty instruction list), an outright `reject`
  (a rationale containing a PII-shaped phone number), and
  `needs-human-approval` (a real CDSS-recommended `AdmitPatient`,
  `review-required` per `risk/patient.ts`). All three severities, not
  just the easy one.
- **The approval-arrives-later boundary `scheduler.ts` already documented
  needed to be checked against a real proposal, not just asserted as
  fine.** `runScheduler` leaves a `needs-human-approval` proposal
  `awaiting-approval` and marks it acted — by design, per "Resolved:
  the scheduler." A dedicated test confirms that boundary doesn't
  strand the proposal: `resolveApprovalForProposal` plus a direct second
  `act()` call — the *exact* mechanism `cdssPlanningEndToEnd.test.ts`'s
  "commits once a human approves" test already uses for the fully
  direct path — commits it, completely unaffected by
  `SchedulerActedStore` having already marked it acted. That store is
  scheduler-internal bookkeeping `runScheduler` alone consults; nothing
  about `act()` itself ever reads it.
- **What this doesn't do: replace the direct path, or decide which one
  a real caller should use.** `patientVerifier` is not deprecated and
  nothing else in the codebase was changed to route through the spine
  instead of it. This slice proves the spine is a safe, equivalent
  *option* for the patient domain now, not that adopting it everywhere
  is the right next move — that would need an actual slow harness this
  domain wants to plug in, the same "deferred until a real need" bar
  every other generalization in this document has had to clear.

## Resolved: the cross-domain, cross-path merged audit timeline

"Event bus vs. federated subscription" above named this and never built
it: "a read-only tool that reads several domains' independent logs and
merge-sorts them by timestamp... gets the same observability outcome
without any domain needing to know the tool exists." `shell.ts`'s own
doc comment raises the same question from a different angle — whether
human- and agent-originated audit records should ever share one
timeline. Both are now checked against a real scenario, not left as an
abstract "still open": `src/agentic/shell/auditTimeline.ts`'s
`AuditTimelineEntry`, `mergeAuditTimelines`, `summarizeAgentAuditRecord`,
and `summarizeHumanAuditRecord`, proven by
`tests/agentic/shell/auditTimeline.test.ts` against three genuinely
separate audit files: patient's agent path (CDSS admission, approved),
patient's human path (a direct discharge), and bed's human path (a
direct assignment) — two domains, both paths, three files that share no
code and know nothing of each other or of this tool.

- **Purely additive and read-only, by construction, not just by
  intent.** Nothing about `ImperativeShell`, `AuditRecord`,
  `HumanActionAuditRecord`, or any domain's file layout changed. The
  tool only calls `readAuditLog` (already existed) and merge-sorts the
  result — the exact "reacting and observing are different needs and
  should stay different mechanisms" split "Event bus vs. federated
  subscription" already argued for, finally given the observability half
  its argument said should exist.
- **The merge is proven to be a real sort, not an artifact of write
  order.** The test deliberately writes the three audit files in a
  different order than the events actually happened in (discharge
  written to disk before the bed assignment, even though the assignment
  happened first) — `mergeAuditTimelines` still reconstructs the correct
  chronological order (admitted → assigned → discharged) reading them
  back, because it sorts by `recordedAt`, not by concatenation order.
- **`encounterId` is deliberately not extracted generically.** The
  doc's own phrasing offered "by timestamp (or by a shared key like
  encounterId)" as two alternatives; `AuditTimelineEntry` carries an
  optional `encounterId` field for a caller who wants the second, but
  no summarizer here tries to pull it out automatically. Different
  domains name and shape the field differently (`ledger`/`nursing` don't
  have one at all), so a generic extractor would need a second real
  domain's shape to check it against before it could be anything but
  guesswork — the identical "extract once two real consumers prove the
  shape, not before" precedent `core/temporal.ts`'s `Tick` and
  `IsoTimestamp` already followed.
- **`summarizeAgentAuditRecord` and `summarizeHumanAuditRecord` are two
  functions, not one branching on shape.** Mirrors why
  `HumanActionAuditRecord` is its own type rather than `AuditRecord`
  reused with placeholder fields in the first place (see that type's own
  doc comment): there was no proposal and no separate Check step for a
  human-issued instruction, so a shared summarizer pretending otherwise
  would misrepresent what actually happened, the same concern that kept
  the two audit types themselves separate.
- **Sorting is a plain string compare on `recordedAt`, never a `Date`
  construction.** ISO-8601 UTC timestamps are fixed-width and
  lexicographic order already is chronological order for them — reaching
  for `Date` here would add an ambient-time-shaped API this module has
  no actual need for, even though `auditTimeline.ts` sits outside
  `determinism.guard.test.ts`'s guarded directories and could have used
  one without tripping any check.

## Resolved: the conservation family, empirically

Every domain proven so far — `patient`, `bed`, `lab` — belongs to the
same "hard core" family: state/time-precision plus regulatory
traceability, where the invariant is either exact replay or "don't
double-book a resource." That left two of the thesis's other named
families untested; this closes one of them: **conservation** — the
double-entry-balance shape this document used as its running
counterexample from the very first section, but never actually built. `src/instructions/ledger` (two
instructions, `PostEntry`/`ReverseEntry`) closes that gap.

- **Step 3, the one step the thesis said would vary, did vary — and
  nothing else needed to.** `postEntryHandler` (`src/instructions/ledger/handlers/postEntry.ts`)
  is where the domain-specific invariant proof actually lives for this
  family: it sums every line's debit and credit amounts and rejects
  outright, before touching any account balance, if they don't match.
  Steps 1, 2, and 4–7 — closed union, validation boundary, combined
  rules, risk-tiered approval, commit+audit, provenance — needed zero
  changes to accommodate this; they were never coupled to what "the
  invariant" happened to mean.
- **The invariant proof itself had to take a different *shape*, not
  just different content.** The clinical core's proof
  (`determinism.guard.test.ts`) is a static grep over source files for
  banned non-deterministic calls — it doesn't execute anything. The
  conservation proof
  (`tests/instructions/ledger/conservation.guard.test.ts`) is the
  opposite shape: it *runs* sixty synthetic instructions through
  `ledgerEngine` and checks, after every single one, that the sum of
  every account's balance across the whole ledger is exactly zero —
  because conservation is a property of accumulated state over a
  sequence, not a property `grep` could ever see in isolated handler
  code. This is exactly what the thesis meant by "the proof mechanism
  doesn't have to be the type system" — it also doesn't have to be the
  *same kind* of runtime check twice.
- **Reversal is the invariant's second-hardest case, and it's solved by
  sharing code, not duplicating logic.** `reverseEntryHandler` doesn't
  recompute an "opposite" entry — it calls the same `applyLines()`
  helper `postEntryHandler` uses, with the sign flipped
  (`src/instructions/ledger/handlers/applyLines.ts`). A reversal is
  therefore provably the exact algebraic inverse of its post, not a
  second implementation that could quietly drift out of balance with
  the first — the same "don't hand-maintain two copies of the same
  fact" discipline `patientToLab.ts`'s handlers already followed
  (reading `encounterId` back off an existing record instead of
  trusting a caller to resupply it).
- **What this doesn't prove:** real ledger/ERP correctness needs far
  more than two instructions — multi-currency, fiscal-period close,
  accrual/reversal timing rules, reconciliation against external bank
  statements. None of that was in scope here, deliberately, same
  restraint as `lab`'s three instructions not modeling a real LIS. The
  claim under test was narrower and now answered: does `core/execution`'s
  closed-union/total-registry/pure-handler shape hold for a *conservation*
  invariant the same way it held for two *state-machine* invariants —
  yes, with the domain-specific proof step being the only thing that had
  to change shape to fit it.

## Resolved: the optimization/feasibility family, empirically

The third and last named family from the original reclassification —
optimization/feasibility, whose named examples are OR scheduling and
roster generation — was still untested after `ledger`. `src/instructions/scheduling`
(`ScheduleBooking`/`CancelBooking`) closes that gap the same way `ledger`
closed the conservation one: minimally, and only to test the claim, not
to build a real scheduler.

- **The invariant is feasibility, not optimality, and that distinction
  is the whole point.** This domain does not find a *good* schedule —
  no search, no "next available slot," no cost function. It only makes
  an *infeasible* one (two bookings on the same resource with
  overlapping times) structurally unable to commit. That is exactly
  what step 3 needs to guarantee for this family: an LLM (or any
  planner) is free to *propose* whatever schedule it wants, however it
  wants to search for one — the deterministic core's only job is
  rejecting proposals that violate the hard constraint, the same
  separation of concerns `core/execution` already drew between
  "propose" and "commit" for the other two families.
- **The invariant check itself is a third distinct *shape*.** `bed`'s
  no-double-booking check reads one status field, O(1). `ledger`'s
  balance check sums one entry's own lines, O(entry size). `scheduling`'s
  feasibility check (`handlers/overlap.ts`'s `findConflicts`) has to scan
  every *other* booking on the same resource and test for interval
  overlap — the first domain-specific invariant proof in this codebase
  that is inherently relational (checked against the rest of the
  dataset) rather than local (checked against the instruction's own
  fields or one existing record). `tests/instructions/scheduling/feasibility.guard.test.ts`
  mirrors that shape: it's a pairwise scan over every currently-scheduled
  booking, not a running sum.
- **The determinism guard forced the right implementation, not just a
  permitted one.** `findConflicts` compares `IsoTimestamp` values as
  plain strings, never by parsing them into a date object — not a style
  choice; `tests/instructions/patient/determinism.guard.test.ts` bans
  constructing that object anywhere under `src/instructions`, and this
  domain is the first one where the guard actually had teeth: patient/
  bed/lab/ledger never needed to compare two timestamps against each
  other, only stamp and store them. Scheduling does, and the guard
  steered the implementation toward exact, timezone-independent string
  comparison instead of a parsing path that could have introduced real
  non-determinism.
- **What this doesn't prove:** real OR scheduling and roster generation
  are actual optimization problems — minimizing idle room time, honoring
  staff qualifications and shift-length rules, balancing fairness across
  a roster. None of that is here, deliberately. The claim under test was
  narrower: does this codebase's containment pattern hold when the
  domain's natural solving strategy is search/optimization rather than a
  simple state transition or a running total — yes, because the pattern
  never asked the *domain* to be simple, only asked the *commit boundary*
  to enforce one hard, checkable constraint before anything reaches it.
  All three named families in the original thesis have now each produced
  at least one real, tested domain — state/time-precision plus
  regulatory traceability already had several even before this (see the
  thesis's family list; more have joined since, each with its own
  "Resolved" section below); conservation and optimization/feasibility
  each have their first here.

## Resolved: CDSS as a Plan source

The "Known boundaries" section above asserted CDSS "is not a new
category — it should be treated as another Plan source, not a parallel
system," but nothing had ever built a second, non-LLM planner to check
that claim against. `src/agentic/planning/cdssPlanner.ts`'s
`createCdssTriagePlanner` does: a deterministic rule ("recommend
admitting every not-yet-admitted patient with an emergent triage
signal") implementing the exact same untrusted `RawPlanner<TCtx>`
contract `createLlmPlanner` implements — see
`tests/agentic/planning/cdssPlanningEndToEnd.test.ts` for the proof.

- **Zero pipeline code changed.** `planWithRetries`, `toPlanProposal`,
  `patientInstructionValidators`, `patientVerifier`, `resolveApprovalForProposal`,
  and `act()` all run against the CDSS-sourced proposal completely
  unmodified. The claim under test — "CDSS is just another Plan source"
  — is exactly the claim that no downstream code needs to know or care
  where a `PlanProposal` came from, and that held.
- **A CDSS recommendation gets no shortcut around Check or approval.**
  `AdmitPatient` is `review-required` (`risk/patient.ts`) regardless of
  who proposed it; the end-to-end test confirms Check still returns
  `needs-human-approval` for the CDSS-sourced proposal, and `act()`
  still refuses to commit without a real, permission-checked `Approval`
  — the same two failure modes (`awaiting-approval` on no response,
  and an impersonation attempt producing nothing `act()` will honor)
  the LLM path already had to handle. This is the concrete form of "not
  a separate, less-rigorous path just because it looks like a rules
  engine instead of an LLM."
- **`RawPlanner<TCtx>`'s `TCtx` never had to equal the domain's own
  execution context.** `CdssTriageContext` bundles `PatientContext`
  alongside a list of structured `TriageSignal`s the rule actually
  needs to decide anything — Do still only ever sees plain
  `PatientContext` when it calls `patientEngine.executeSequence`. This
  wasn't a change made to accommodate CDSS; `Planner`/`RawPlanner`'s
  `TCtx` was always "whatever informs planning," and CDSS is simply the
  first planner that needed it to be richer than what Do/Check/Act
  need.
- **Retrying is where a deterministic planner's difference from an LLM
  actually shows up.** `llmPlanningEndToEnd.test.ts` recovers from a
  hallucinated instruction within two attempts because the model reads
  `feedback` and changes what it produces. The CDSS retry test here
  shows the opposite: the same broken input, fed back through the exact
  same `planWithRetries` loop, produces the *identical* validation
  failure on every attempt up to `maxAttempts`, because a rule that
  ignores `feedback` by construction has nothing to change. This isn't
  a defect in `planWithRetries` — retries were only ever an LLM-shaped
  coping mechanism for probabilistic mistakes; a deterministic planner
  either gets it right the first time or needs a person or a rule
  change, not another attempt.
- **A minor, honest friction point:** `RawPlanOutput`'s `modelVersion`/
  `promptVersion` fields are LLM-shaped names. CDSS repurposes them (rule
  engine version, ruleset identifier) rather than the pipeline gaining
  CDSS-specific fields — acceptable for a proof-of-shape exercise, worth
  revisiting if a third, differently-shaped planner ever needs its own
  provenance vocabulary.

## Resolved: large binary objects (PACS/DICOM reference-by-ID)

The other bullet from "Known boundaries" worth the same build-and-verify
treatment: large binary objects don't fit a plain-JSON context, and the
proposed fix was reference-by-ID, same discipline `EncounterId` already
models for cross-domain foreign keys. `src/instructions/imaging`
(`OrderStudy`/`RecordStudyStored`/`ReportStudy`) builds that convention
as a real, tested domain instead of a sentence in a doc.

- **The convention only means anything if it's enforced, not just
  followed.** `recordStudyStoredHandler` rejects any `storageRef` longer
  than `MAX_STORAGE_REF_LENGTH` (512 characters — generous for a real
  object-store key or URI, minuscule next to actual pixel data). Without
  that check, nothing stops a caller from passing embedded image bytes
  through the one field this domain exposes for it, and the whole point
  of the convention silently fails the first time someone does. This is
  the same "the proof mechanism doesn't have to be the type system, but
  it has to be a check something actually runs" principle `ledger`'s
  balance check and `scheduling`'s overlap check already established —
  applied here to a structural/payload-size property instead of a
  numeric or temporal one, a fourth distinct shape of domain-specific
  invariant.
- **The check is about the boundary, not any one instruction.**
  `tests/instructions/imaging/referenceById.guard.test.ts` doesn't just
  check one `RecordStudyStored` call in isolation (`recordStudyStored.test.ts`
  already does that) — it runs thirty studies through `imagingEngine`
  and asserts the *entire accumulated context* stays a few hundred bytes
  per study, never growing anywhere near what real image data would
  cost. Bounding one field's length is only meaningful if it actually
  keeps the aggregate small too.
- **What this doesn't prove:** it says nothing about the specialized
  store `storageRef` actually points to — durability, access control,
  DICOM-specific metadata (SOP Instance UID, series/study hierarchy),
  or how a real PACS integration authenticates and retrieves bytes by
  that reference. None of that is this codebase's problem to solve; the
  claim under test was narrower and now answered: can the deterministic
  core stay small, plain-JSON, and fully auditable while a domain it
  governs references gigabyte-scale data it never touches — yes, as
  long as the reference itself is bounded and that bound is checked, not
  assumed.
- **An asymmetry with `lab`, spotted after the fact, not designed
  around — now closed completely.** Lab shipped with `CancelLabOrder`
  because it was built to test choreography (`patientToLab.ts` needs a
  real instruction to cancel pending orders on discharge). Imaging was
  built later for an unrelated purpose — the reference-by-ID convention
  above — and simply never got the same instruction, leaving a
  still-pending, un-performed study with no way to be resolved at
  discharge. `CancelStudy` closed the structural half: only cancellable
  while still `'ordered'` (mirroring `CancelLabOrder`'s own
  restriction), reusing `StudyNotOrdered` rather than a new error kind,
  the same way `cancelLabOrderHandler` reuses `LabOrderNotPending`.
  `src/integration/patientToImaging.ts` closed the choreography half —
  `reactToPatientEffectsForImaging` mirrors `reactToPatientEffectsForLab`
  field-for-field: no reaction to `EncounterAdmitted`, a one-to-many
  cancel-every-still-pending-study reaction to `EncounterDischarged`,
  the same best-effort and redelivery-safety properties.
  `src/integration/outboxRelayImaging.ts` closes the last piece —
  `relayPatientEffectsToImaging` mirrors `relayPatientEffectsToLab`
  exactly: reads the patient domain's durable commit log, tracks
  progress with a durable cursor, commits imaging effects before
  advancing past each entry. Notably has no saga-wrapped reactor the
  way bed's relay optionally does — nothing needed one, since cancelling
  a study has no compensating "un-cancel" the way an assign/release
  pair does, confirming that concern really is bed-specific, not
  something every relay needs. `tests/integration/outboxRelayImaging.test.ts`
  proves durability end to end: a durably committed discharge produces
  a durably committed cancellation, redelivers safely if the cursor is
  ever reset, and a second run with nothing new processes nothing new —
  the same three properties `outboxRelayLab.test.ts` already proved for
  lab. Lab and imaging are now symmetric in every respect that matters:
  instruction, reaction, and durable relay.

## Resolved: remote care data volume (benchmarked)

The last "Known boundaries" bullet was explicitly a performance
question, not a correctness one, so it needed a different kind of
verification than the five domains above — a measurement, not a small
proof-of-shape exercise. `tests/benchmarks/outboxRelayVolume.bench.test.ts`
(run via `npm run benchmark`, deliberately excluded from `npm test` —
see `vitest.config.ts`/`vitest.benchmark.config.ts` — because a timing
number is not a pass/fail correctness assertion and shouldn't be able to
flake CI) writes a large synthetic patient commit log, advances the
cursor to the end of it, appends exactly one new entry, and times both
`readCommits` alone and a full `relayPatientEffectsToBed` call that has
to process just that one new entry.

Measured on the machine this was run on (illustrative, not an SLA —
absolute numbers will differ elsewhere; the *shape* of the result is
the actual finding):

| Historical entries already behind the cursor | `readCommits` | `relayPatientEffectsToBed` (1 new entry) |
|---|---|---|
| 1,000 | 2.51ms | 15.16ms |
| 10,000 | 14.15ms | 29.45ms |
| 50,000 | 61.62ms | 102.94ms |
| 100,000 | 132.21ms | 145.89ms |

- **The concern was real, not hypothetical, and it's confirmed
  quantitatively: relaying one new event costs more, in direct
  proportion to how much unrelated history already sits in the log,
  than it costs to do the actual new work.** `relayEffects`
  (`core/io/relay.ts`) reads and parses the *entire* file every call
  regardless of cursor position — at 100,000 historical entries, that
  read is already ~90% of the total time to process one new admission.
  This is exactly the "read the whole commit log, process what's new"
  design the doc flagged, now with a number attached instead of a guess.
- **It's linear, not worse — which is the reassuring half of the
  finding.** Time roughly tracks entry count (a 100x growth in history,
  1,000 → 100,000, produced roughly a 50x growth in read time, not
  10,000x) — there's no quadratic or exponential pathology hiding in
  here, just the inherent cost of "parse every line" applied to a file
  that keeps growing. A continuous vitals stream is a *volume* problem
  for this design, not a correctness or stability one.
- **The practical implication is exactly what the doc already
  anticipated, now backed by a number to reason from instead of a
  guess:** a synchronous "relay after every single new event" access
  pattern degrades as the log grows past roughly tens of thousands of
  entries, and would need either batching (accumulate several new
  events, relay them together, amortizing one read across many) or log
  rotation/archival (cap how much history any one relay run has to
  scan) well before the log reaches the sizes a real continuous
  remote-monitoring stream would produce over weeks. Neither fix was
  built here — this benchmark's job was only to convert "might be fine
  as-is or might need a different strategy" into a concrete threshold to
  design against, not to build the strategy itself. **The batching half
  has since been built and verified — see "Resolved: batching for
  remote care data volume" below.**

## Resolved: batching for remote care data volume

The benchmark above quantified the concern; this builds and verifies
the fix it recommended. `src/core/io/batchedRelayDriver.ts`'s
`createBatchedRelayDriver` coalesces several new source commits into
one relay call instead of one call per commit — `relayEffects` itself
is completely unchanged, since it already processes however many new
entries exist since the cursor in a single call. The fix is entirely
about *when* a caller invokes it, not about the relay mechanism.

- **The driver has no notion of "how many commits are pending" that
  requires reading anything back off disk — deliberately.** The count
  is something the caller already knows the instant it happens (it just
  committed one). Tracking it in-process, not durably, means a restart
  just resumes accumulating from zero — the worst case is one batch
  relays slightly earlier than it otherwise would, never later or not
  at all, since `relayEffects`'s own cursor is what actually guarantees
  no source commit is ever skipped regardless of how this driver
  batches calls to it. The two mechanisms compose without either
  needing to know about the other, the same way the outbox pattern and
  saga/compensation already do.
- **Verified with a real, apples-to-apples comparison, not just
  reasoned about.** `tests/benchmarks/batchedRelayVolume.bench.test.ts`
  runs the same 150 new commits against the same starting 20,000-entry
  historical log twice — once relaying after every single commit, once
  batching 15 at a time — and measures total time for each. Measured
  result: naive totaled 5110.27ms across 150 calls; batched totaled
  732.11ms across 10 calls — a 7.0x speedup. The test's actual assertion
  is `batchedTotalMs < naiveTotalMs`, not a fixed number (machine-
  dependent numbers would make this a source of CI flakiness for a
  question that's about relative improvement, not an absolute target).
- **Two independent thresholds, not one, because count alone isn't
  enough.** `BatchingPolicy.maxWaitMs` bounds staleness during
  low-volume periods — without it, a batch that never reaches
  `maxPendingCount` would sit unrelayed forever. `flush()` exists for
  the same reason at the other end (e.g. graceful shutdown): nothing
  accumulated should ever be silently left stranded just because a
  threshold was never crossed.
- **What this doesn't prove:** log rotation/archival, the other half
  of the original recommendation, wasn't built *here* — batching reduces
  how often the whole log gets read, but doesn't bound how large that
  log is allowed to grow indefinitely. At sufficiently large accumulated
  history, even a batched relay's occasional full reads would eventually
  become expensive again; batching raises the volume threshold where
  that starts to matter, it doesn't remove the threshold. Nor does this
  address *how* a real caller decides `BatchingPolicy`'s actual numbers
  for a real deployment's actual event rate — `maxPendingCount: 15`
  here is illustrative, not a recommendation. **Log rotation has since
  been built and verified — see "Resolved: log rotation for remote care
  data volume" below.**

## Resolved: log rotation for remote care data volume

Batching amortizes the full-log read across many events — a
constant-factor win, but the log itself was still unbounded, so at
large enough accumulated history even a batched relay's occasional
reads would eventually become expensive again. `src/core/io/segmentedCommitLog.ts`
builds the complementary fix: commits are written across a *sequence*
of bounded segment files instead of one ever-growing one, with a
durable manifest recording each closed segment's line count so a
reader can compute exactly which segment contains what it's asking for
*without opening any segment it doesn't need*.

- **This required generalizing `relayEffects` first, not adding a
  parallel relay function.** The loop only ever needed "give me what's
  new from index N," never specifically "a file path" — `relayEffects`'s
  first parameter changed from `sourceCommitsFile: string` to
  `readNewCommits: (fromIndex: number) => readonly CommittedBatch<...>[]`,
  and `outboxRelay.ts`/`outboxRelayLab.ts` each got a one-line change
  (wrap their existing `readCommits(file).slice(fromIndex)` in a
  closure) to preserve their exact prior behavior. The alternative —
  a second, copy-pasted relay loop for segmented logs — would have
  repeated exactly the duplication this codebase already chose not to
  keep once `relayPatientEffectsToBed`/`relayPatientEffectsToLab`
  proved the loop itself was domain-agnostic.
- **The manifest is what makes "skip without opening" possible — a
  segment's own line count has to be knowable without reading its
  content.** One line per *closed segment*, not one line per entry — with
  `maxLinesPerSegment` in the thousands, even a huge total history
  produces a small, cheap manifest. `tests/core/io/segmentedCommitLog.test.ts`
  proves the "without opening" half concretely, not just by construction:
  it corrupts an old, fully-behind segment's file content with invalid
  JSON and confirms reading past it still succeeds — if the reader ever
  opened that file, `JSON.parse` would throw.
- **Verified as the stronger claim it actually is, not just "faster."**
  Batching is a constant-factor speedup; segmentation is supposed to
  make read cost *independent of total history size* entirely, as long
  as a caller is asking for something recent.
  `tests/benchmarks/segmentedLogVolume.bench.test.ts` holds "how far
  behind the cursor is" constant at 100 entries and grows total history
  across three orders of magnitude. Measured result:

  | Total history | Single-file read | Segmented read |
  |---|---|---|
  | 10,000 | 9.90ms | 9.91ms |
  | 100,000 | 83.52ms | 16.05ms |
  | 1,000,000 | 1,123.19ms | 9.74ms |

  Single-file cost grows with total history, matching
  `outboxRelayVolume.bench.test.ts`'s earlier finding exactly. Segmented
  cost does not — it stays flat regardless of whether there are 10,000
  or 1,000,000 entries behind the tail being read, because the segments
  containing them are never opened at all.
- **Loud failure over silent data loss, the same discipline as
  everywhere else in this codebase.** If a segment a reader actually
  needs is missing on disk, `readSegmentedCommitsFrom` throws a
  descriptive error rather than silently returning less than actually
  exists — the same posture as `validateInstruction`, `resolveApproval`,
  and `findBedHoldingEncounter`'s ambiguous case. This is what makes
  `src/core/io/segmentArchival.ts`'s own safety check load-bearing
  rather than decorative: `archiveFullyProcessedSegments` only moves a
  closed segment once *every* supplied cursor has advanced past it
  (fails closed — archives nothing — if given zero cursors), and
  `tests/core/io/segmentArchival.test.ts` proves the failure mode this
  guards against directly: a consumer left out of the cursor list hits
  exactly the "missing segment" error above the next time it tries to
  read.
- **What this doesn't prove:** archival only protects consumers it's
  told about — a real deployment has to actually enumerate every live
  consumer when deciding what's safe to move, which this reference
  implementation has no way to discover on its own (the same "this
  reference implementation doesn't invent what it can't know" reasoning
  `docs/AGENTIC_LAYER.md` already applies to `fileShell.ts`'s missing
  retention/backup/encryption story). Nor does this decide real values
  for `maxLinesPerSegment` or where an archive directory should actually
  live (cold storage, a different retention tier, ...) for any real
  deployment's real volume and compliance requirements.

## Resolved: message-ID idempotency for external protocol integration

Revisiting "external protocol integration is a different kind of
boundary than choreography between two of our own domains" more
carefully than the first pass did: most of that boundary really is just
protocol-specific parsing work with no architectural claim left to test
— CDSS already proved a structurally different, non-LLM input source
flows through the identical validation/Check/Act gate, and the LLM
planner path already covers input that doesn't even parse. But one real
mechanism was hiding inside that bullet, untested by anything built so
far: **every dedup/idempotency mechanism in this codebase up to this
point works because *we* control the ordering of our own log.**
`patientToBed.ts`'s `findBedHoldingEncounter` check and `outboxRelay.ts`'s
cursor both reduce "have I already handled this" to a position in a log
we own. A real external interface — a lab analyzer, an imaging modality
— has no such position: its own retry logic can redeliver the *same
logical message* through any channel, at any time, with nothing tying
it to our log at all. `src/integration/externalMessageIdempotency.ts`
and `externalLabResultAdapter.ts` build and test that one mechanism,
deliberately isolated from real protocol parsing (`ExternalLabResultMessage`
is a synthetic shape, not HL7v2/FHIR) and from network-liveness concerns
(ACK/NAK, retry/backoff, connection handling) — both still genuinely out
of scope, not deferred with guilt.

- **A membership store is a different data structure than a cursor, not
  a variation on one.** `MessageIdempotencyStore.hasProcessed(id)` asks
  "have I seen *this specific* value," which needs a set; `OutboxCursor.read()`
  asks "how far have I gotten," which needs one number. Trying to force
  external-message dedup through the cursor abstraction would have
  meant inventing a fake position for messages that don't have one —
  the two mechanisms needing genuinely different shapes is itself part
  of the finding, not an implementation detail.
- **The write-then-mark ordering discipline transfers directly, and
  that's the reassuring half.** `ingestExternalLabResult` commits the
  effect *before* calling `store.markProcessed`, the same "durable
  action before durable acknowledgment" principle `outboxRelay.ts`
  established for its cursor — a crash between the two means the
  message looks unprocessed on redelivery and gets retried, never
  silently dropped. That this discipline ports unchanged to a
  structurally different store is evidence it's a real principle, not
  an accident of how `OutboxCursor` happened to be built.
- **The domain's own state check is a second, independent safety net —
  proven, not just asserted.** `tests/integration/externalLabResultAdapter.test.ts`'s
  belt-and-suspenders test deliberately leaves the idempotency store
  behind reality (commits an effect, skips `markProcessed`, simulating
  a crash between them) and confirms redelivery still lands safely: it
  re-attempts the domain operation for real, which `reportLabResultHandler`
  rejects with `LabOrderNotPending` because the order is already
  `resulted`. The message-ID store optimizes the common case (skip
  before touching domain state at all); the domain's own invariant
  checks are what make it safe even when that optimization's own
  bookkeeping is the thing that's out of sync.
- **What this doesn't prove:** nothing about actually parsing HL7v2
  segments, FHIR resources, or DICOM metadata into `ExternalLabResultMessage`'s
  shape, and nothing about a live connection's ACK/NAK handshake,
  retry/backoff, or a device being offline. Those remain real,
  necessary, unglamorous engineering for an actual integration, with no
  generalizable pattern-claim behind them — building a toy version of
  either would not have taught this codebase anything a small, focused
  idempotency exercise didn't already cover.

## Resolved: nursing's credential/role state, split from roster generation

Nursing was deferred early on because it conflates two unrelated
concerns: credential/role state, and roster generation — the latter
already tested by `scheduling`'s optimization/feasibility family.
`src/instructions/nursing` (`IssueCredential`/`RevokeCredential`/`GrantRole`)
builds and tests only the first half, deliberately excluding shift
assignment, patient ratios, or anything else a real nursing information
system would need.

- **Same family, new invariant *shape* within it.** Nursing belongs to
  the same state/time-precision-plus-regulatory family `patient`/`bed`/`lab`
  do — not a fourth family. But its invariant is neither a state
  transition nor a resource-exclusivity check: it's a *gating*
  relationship between two kinds of state. `grantRoleHandler` doesn't
  just check `GrantRole`'s own fields; it looks up a *different*
  entity (the referenced credential) and enforces three conditions
  against it — same staff member, not revoked, not yet expired —
  before the grant is allowed to exist at all.
- **The independent guard check had to be built carefully to avoid
  testing a tautology.** `tests/instructions/nursing/credentialValidity.guard.test.ts`
  re-derives "was this credential valid at grant time" from the
  credential's own write-once fields (`issuedAt`/`expiresAt` never
  change after issuance; `revokedAt` is set at most once) rather than
  calling `grantRoleHandler`'s check again — but doing that correctly
  required generating strictly increasing timestamps so instruction
  *sequence* order and timestamp *value* order never diverge. Without
  that, a randomly-generated backdated grant could be correctly rejected
  by the handler (which reasons about sequence: has this credential
  already been revoked *by this point in the run*) while the
  independent checker — reasoning purely about timestamp values —
  would disagree, producing a false failure unrelated to any actual bug.
  Both `ledger`'s and `scheduling`'s guards already generated timestamps
  this way; this is the first domain where skipping that discipline
  would have silently broken the test's own validity, not just its
  realism.
- **The connection to `IdentityProvider` has since been made — see
  "Resolved: a real `IdentityProvider`, backed by nursing" below.** This
  bullet originally said the connection was a "first, not-yet-taken
  step" — true when this section was written, no longer true a few
  commits later. Left here, annotated, rather than quietly rewritten,
  same discipline this document already applies to its other
  superseded claims.
- **What this doesn't prove:** real nursing credentialing needs far more
  than this — competency-specific role requirements, unit-level
  scope-of-practice rules, grace periods for in-progress
  recredentialing, multi-credential role requirements (e.g. a role
  needing *both* an active RN license *and* a current unit-specific
  certification). None of that is here, deliberately, same restraint as
  every other domain's minimal slice. The claim under test was
  narrower and now answered: can a *gating* invariant between two kinds
  of state — not a transition, not a conservation law, not a feasibility
  constraint — be enforced with the same discipline as the other three
  shapes already proven. Yes, and it required no change to
  `core/execution` to do it.

## Resolved: a real IdentityProvider, backed by nursing

`src/agentic/identity/nursingIdentityProvider.ts`'s `createNursingIdentityProvider`
derives `Identity.roles` from `nursing`'s committed credential/role-grant
state instead of a hand-maintained list — the connection the previous
section named as a plausible next step, now actually built.

- **The existing `IdentityProvider` interface had no way to ask "as of
  when," and that had to be fixed first.** Whether an identity still
  holds a role is inherently a question about a specific moment — a
  time-varying provider needs *some* timestamp to check expiry/revocation
  against. `IdentityProvider.resolve()` gained an explicit `asOf: string`
  parameter (not ambient time — the same discipline every handler in
  this codebase already follows). `createInMemoryIdentityProvider`
  accepts and ignores it, since a fixed directory has no time dimension
  to answer against at all; `resolveApproval.ts` now threads
  `ApprovalRequest.decidedAt` through as `asOf` — a timestamp that was
  already being collected and simply wasn't reaching the one place that
  needed it.
- **The validity check had to be genuinely retrospective, not just
  "current," and that's a different check than `grantRoleHandler`'s
  own.** `grantRoleHandler` checks revocation via the credential's
  *current* `status` — correct for processing an instruction now, in
  sequence. `nursingIdentityProvider.ts` needs to correctly answer for
  *any* `asOf`, including a past moment during a retrospective audit
  review of an old decision — so its check
  (`src/instructions/nursing/credentialValidity.ts`'s `isCredentialValidAsOf`)
  compares `asOf` against `revokedAt` as a *value*, not against current
  `status`. These are two different checks for two different purposes,
  not a duplicate — and the same `isCredentialValidAsOf` is now shared
  between the real provider and the guard test that independently
  verifies it, rather than each maintaining its own copy.
- **"Known but currently ineligible" and "never seen at all" stayed
  distinguishable, on purpose.** A staff member with only expired or
  revoked grants still resolves to `{ roles: [] }`, not `undefined` —
  `resolveApproval.ts` already reports a different, more accurate
  reason for each ("holds none of the required roles" vs. "no identity
  found"), and collapsing the two would have thrown that distinction
  away for no reason.
- **Proven through the unmodified pipeline, not just in isolation.**
  `tests/agentic/identity/nursingIdentityProviderApprovalFlow.test.ts`
  runs `resolveApprovalForProposal` — completely unchanged — against a
  `DischargePatient` proposal, with the same approver resolving
  successfully before their credential expires and failing to resolve
  after, using the exact same `decidedAt` timestamp that would occur if
  a human clicked approve at two different real moments. This is the
  same "swap the provider, not the pipeline" property CDSS already
  proved for planners, now proved for identity.
- **What this doesn't prove:** `identityId` is assumed to be the same
  identifier space as `StaffId` — a simplifying assumption, not a real
  identity-federation design. Nothing here handles a staff member with
  multiple concurrent employments, delegated/temporary credentials, or
  what happens if `nursingContext` itself is stale relative to the
  moment `resolve` is called (this provider takes a snapshot, not a
  live handle — staleness is the caller's problem, the same way it
  already is for `readLatestContext` elsewhere). And this remains one
  domain's worth of identity — a real deployment's actual staff
  registry, SSO, or LDAP/AD directory is still the real
  `IdentityProvider` most institutions would actually need.

## Resolved: lab's agentic-layer integration

A synthesis question — "given the seven domains that exist, what's the
highest-value gap?" — surfaced something the domain-by-domain narrative
above never said out loud: every piece of Plan→Do→Check→Act
infrastructure (`RiskTierRegistry`, `InstructionValidatorRegistry`,
`Verifier`, `ApprovalPolicy`) existed *only* for `patient`. Six domains
proved `core/execution` and the planner shape both generalize; none of
them proved the containment *pipeline itself* generalizes across
domains, which is the more important axis for what this system is
actually for — an LLM or CDSS could never have proposed anything
outside `AdmitPatient`/`DischargePatient`, no matter how many domains
existed underneath. `src/agentic/{risk,validation,verification,identity}/lab.ts`
close that gap for a second domain: `labRiskTiers`, `labInstructionValidators`,
`labVerifier`, `EXAMPLE_labApprovalPolicy` — the same four pieces
`patient.ts` has, assembled the same way.

- **The domain-agnostic factories were never actually exercised by a
  second caller until now.** `createMaxBatchSizeVerifier`,
  `createRationalePiiScanVerifier`, `createRiskTierVerifier`,
  `combineVerifiers` — all written generically from the start, but
  `patient.ts` was their only caller for the whole life of this
  codebase. `labVerifier` assembling them is the same kind of proof
  `relayEffects` needed a second real caller for: generic-looking code
  that's never been called twice isn't provably generic yet, just
  plausibly so.
- **Risk tiers had to be reasoned about on their own terms, not copied
  from patient's.** `ReportLabResult` gets `'approval-required'` —
  lab's *own* top tier — because a wrong committed result can directly
  drive a wrong clinical decision downstream, the same terminal-
  consequence shape `DischargePatient` has, but for a completely
  different clinical reason. `OrderLabTest`/`CancelLabOrder` get
  `'review-required'`, mirroring `AdmitPatient`'s "correctable,
  lower-consequence" reasoning. Getting a second domain's tiers right
  meant re-deriving the *reasoning*, not pattern-matching the *shape*
  of patient's tiers onto different instruction names.
- **`EXAMPLE_labApprovalPolicy` deliberately doesn't reuse patient's
  role list wholesale.** It introduces `lab-technologist` — a role
  patient's own policy never needed — precisely to test whether the
  approval-policy mechanism actually respects domain-specific role
  taxonomies or secretly assumes patient's roles are universal.
  `tests/agentic/lab/labAgenticPipelineEndToEnd.test.ts`'s third case
  proves it does: a `lab-technologist` identity can approve
  `OrderLabTest` (`'review-required'`) but is correctly refused for
  `ReportLabResult` (`'approval-required'`, needs `physician`) —
  the exact same differentiated-role property `patientRiskTiers`
  demonstrates between `AdmitPatient` and `DischargePatient`, now
  shown to hold for a domain whose roles aren't patient's.
- **Proven through the real chain, not just type-checked.**
  `labAgenticPipelineEndToEnd.test.ts` runs a raw, untrusted candidate
  through `toPlanProposal` → `labEngine.executeSequence` (Do) →
  `labVerifier` (Check) → `resolveApprovalForProposal` → `act()` to a
  real commit — mirroring `approvalFlow.test.ts`'s depth for patient,
  now demonstrated for lab specifically, not asserted by analogy.
- **What this doesn't prove:** at the time this section was written,
  the other five domains (bed, ledger, scheduling, imaging, nursing)
  still had no agentic-layer integration at all — this closed the gap
  for one additional domain, not the general claim "any domain can
  trivially get one." **Bed has since been closed too — see the next
  section.** Nor does it decide real risk tiers or approval policies
  for a real deployment — `labRiskTiers` and `EXAMPLE_labApprovalPolicy`
  are exactly as illustrative as patient's own versions, same restraint,
  same `EXAMPLE_` discipline.

## Resolved: bed's agentic-layer integration

The second domain (after `lab`) to get real agentic-layer integration.
`src/agentic/{risk,validation,verification,identity}/bed.ts` supply
`bedRiskTiers`, `bedInstructionValidators`, `bedVerifier`, and
`EXAMPLE_bedApprovalPolicy` — the same four pieces `patient.ts` and
`lab.ts` have.

- **Bed's two instructions share one tier, and that's a real finding,
  not an oversight.** `AssignBed`/`ReleaseBed` both get
  `'review-required'`, because *neither* independently earns anything
  higher: both are reversible moves on a physical asset (a bed), not
  clinical facts a downstream decision gets silently built on top of —
  unlike `ReportLabResult` or `DischargePatient`, neither has a
  terminal-consequence shape. Lab and patient each needed two tiers
  because each had one instruction that genuinely differed in
  consequence; bed doesn't have that instruction, so it doesn't get a
  second tier. Tiering is being reasoned about per instruction, not
  mechanically produced to fill out a fixed number of levels per
  domain — this is what proves that: a domain is free to *not* need
  differentiation.
- **`EXAMPLE_bedApprovalPolicy` pushes the "domain-specific role
  taxonomy" claim further than lab did.** Lab's policy still listed
  `physician` alongside `lab-technologist` for its lower tier.  Bed's
  `'review-required'` list is `['charge-nurse', 'bed-coordinator']` —
  no `physician` at all. Bed assignment is a nursing/patient-flow
  operation in a real hospital, not a physician's job, and the policy
  says so directly: a `physician`-only identity is correctly refused.
  `tests/agentic/bed/bedAgenticPipelineEndToEnd.test.ts`'s third case
  proves it: `dr-wu` (`roles: ['physician']`) cannot approve `AssignBed`;
  a `bed-coordinator` identity can. Because bed has only one tier, this
  test demonstrates role-correctness *within* that tier rather than
  differentiation *across* tiers the way lab's did — a different, still
  meaningful, way the same mechanism can be shown to work.
  `'approval-required'`'s role list (`['charge-nurse']`) is a
  placeholder no current `BedInstruction` ever reaches — total for
  `ApprovalPolicy`'s type, but not exercised by any real bed proposal
  today.
- **Third real caller of the domain-agnostic verifier factories.**
  `bedVerifier` composes `createRationalePiiScanVerifier`,
  `createMaxBatchSizeVerifier`, and `createRiskTierVerifier` exactly as
  `patientVerifier` and `labVerifier` do — the factories now have three
  independent callers, not two.
- **Proven through the real chain, not just type-checked.**
  `bedAgenticPipelineEndToEnd.test.ts` runs a raw, untrusted `AssignBed`
  candidate through `toPlanProposal` → `bedEngine.executeSequence` (Do)
  → `bedVerifier` (Check) → `resolveApprovalForProposal` → `act()` to a
  real commit against a bed that was actually `'available'` beforehand,
  plus a malformed-candidate rejection case and the role-correctness
  case above.
- **What this doesn't prove:** at the time this section was written,
  ledger, scheduling, imaging, and nursing still had no agentic-layer
  integration — two of seven domains had it, five didn't. **Ledger has
  since been closed too — see the next section.** Nor does it decide
  real risk tiers or approval policies for a real deployment —
  `bedRiskTiers` and `EXAMPLE_bedApprovalPolicy` are exactly as
  illustrative as patient's and lab's own versions.

## Resolved: ledger's agentic-layer integration

The third domain (after `lab`, `bed`) to get real agentic-layer
integration. `src/agentic/{risk,validation,verification,identity}/ledger.ts`
supply `ledgerRiskTiers`, `ledgerInstructionValidators`, `ledgerVerifier`,
and `EXAMPLE_ledgerApprovalPolicy`.

- **Tier split derived from ledger's own instruction set having no
  inverse for `ReverseEntry`, not copied from anyone else's reasoning.**
  `PostEntry` gets `'review-required'`: it has a direct in-domain undo
  (`ReverseEntry`), the same "correctable, lower-consequence" shape
  `AdmitPatient` and `OrderLabTest` get that tier for. `ReverseEntry`
  gets `'approval-required'`: there is no `UnreverseEntry`, and a
  reversed `EntryRecord` never goes back to `posted` — fixing a
  wrongful reversal means posting a brand-new corrective entry, not
  undoing the reversal itself. That is the same "terminal within this
  domain" shape `DischargePatient` and `ReportLabResult` earn their top
  tier for, but discovered here from ledger's own instruction set
  (nothing undoes `ReverseEntry`), independently of either.
- **First array-valued instruction field any validator has had to
  shape-check.** `PostEntry.lines` is a non-empty array of
  `{ accountId, direction, amount }` objects — `validatePostEntry`
  checks each element's shape (non-empty `accountId`, `direction` is
  exactly `'debit'` or `'credit'`, `amount` is an integer) the same way
  every other field here gets a shape check, but deliberately does
  *not* check that debits equal credits — that conservation invariant
  stays `postEntryHandler`'s job at Do-time, the same validator/handler
  division of labor `EntryAlreadyExists` and `BedAlreadyOccupied`
  already establish elsewhere.
- **`EXAMPLE_ledgerApprovalPolicy` is the first policy drawn from a
  non-clinical, non-nursing profession.** `'billing-clerk'` and
  `'finance-controller'` appear in no other domain's policy — patient,
  lab, and bed's roles are all clinical or nursing; ledger's are
  finance/billing. `'approval-required'` excludes `'billing-clerk'`,
  the same "narrower list at the higher tier" shape every prior domain's
  policy has. `tests/agentic/ledger/ledgerAgenticPipelineEndToEnd.test.ts`'s
  third case proves it: `clerk-tan` (`roles: ['billing-clerk']`) can
  approve `PostEntry` but is correctly refused for `ReverseEntry`.
- **Fourth real caller of the domain-agnostic verifier factories.**
  `ledgerVerifier` composes the same three factories `patientVerifier`,
  `labVerifier`, and `bedVerifier` do.
- **Proven through the real chain, not just type-checked.**
  `ledgerAgenticPipelineEndToEnd.test.ts` runs a raw, untrusted
  `PostEntry` candidate through `toPlanProposal` →
  `ledgerEngine.executeSequence` (Do) → `ledgerVerifier` (Check) →
  `resolveApprovalForProposal` → `act()` to a real commit that actually
  updates both account balances, plus a malformed-candidate rejection
  case and the role-differentiation case above.
- **What this doesn't prove:** at the time this section was written,
  scheduling and imaging and nursing still had no agentic-layer
  integration — three of seven domains had it, four didn't.
  **Scheduling has since been closed too — see the next section.** Nor
  does it decide real risk tiers or approval policies for a real
  deployment — `ledgerRiskTiers` and `EXAMPLE_ledgerApprovalPolicy` are
  exactly as illustrative as every other domain's own versions.

## Resolved: scheduling's agentic-layer integration

The fourth domain (after `lab`, `bed`, `ledger`) to get real
agentic-layer integration. `src/agentic/{risk,validation,verification,identity}/scheduling.ts`
supply `schedulingRiskTiers`, `schedulingInstructionValidators`,
`schedulingVerifier`, and `EXAMPLE_schedulingApprovalPolicy`.

- **Tier split confirmed by reading the handler, not assumed by
  analogy.** `ScheduleBooking` gets `'review-required'` — correctable
  via `CancelBooking`, the same shape `AdmitPatient`/`PostEntry` get
  that tier for. `CancelBooking` gets `'approval-required'`, and the
  reasoning was checked directly against `scheduleBookingHandler`'s
  actual code before writing it down: `if (ctx.bookings[instruction.bookingId])`
  rejects with `BookingAlreadyExists` for *any* existing key, cancelled
  or not — there's no status check. So a cancelled `bookingId` can
  never be scheduled again; recovering from a wrongful cancellation
  needs a brand-new `bookingId`, the same "terminal within the domain"
  shape `ReverseEntry` has. Scheduling adds a consequence ledger
  doesn't: the freed time range becomes legally bookable by a third
  party immediately, so a wrongful cancellation can lose the slot to
  someone else before anyone notices, not just require re-entering data.
- **`EXAMPLE_schedulingApprovalPolicy` uses disjoint tiers, not nested
  ones — and that's a genuinely new shape.** Every prior domain's
  higher tier was a *subset* of its lower tier's role list (lab's
  `physician` alone out of `[physician, lab-technologist]`; ledger's
  `finance-controller` alone out of `[billing-clerk, finance-controller]`).
  Scheduling's `'review-required': ['scheduling-coordinator']` and
  `'approval-required': ['or-director']` share nothing. Read against
  `resolveApproval.ts`'s actual implementation before writing this
  policy: it never compares roles across tiers, only looks up the one
  tier's own list — so disjoint tiers work exactly as well as nested
  ones, proving the mechanism doesn't quietly assume a seniority
  hierarchy. `tests/agentic/scheduling/schedulingAgenticPipelineEndToEnd.test.ts`'s
  third case proves it in practice: `coord-hsu` (`roles:
  ['scheduling-coordinator']`) can approve `ScheduleBooking` but is
  refused outright for `CancelBooking` — not "insufficiently senior,"
  simply holding none of that tier's roles at all.
- **Fifth real caller of the domain-agnostic verifier factories.**
  `schedulingVerifier` composes the same three factories every other
  domain's verifier does.
- **Proven through the real chain, not just type-checked.**
  `schedulingAgenticPipelineEndToEnd.test.ts` runs a raw, untrusted
  `ScheduleBooking` candidate through `toPlanProposal` →
  `schedulingEngine.executeSequence` (Do) → `schedulingVerifier`
  (Check) → `resolveApprovalForProposal` → `act()` to a real commit,
  plus a malformed-candidate rejection case and the disjoint-role case
  above.
- **What this doesn't prove:** at the time this section was written,
  imaging and nursing still had no agentic-layer integration — four of
  seven domains had it, two didn't. **Imaging has since been closed
  too — see below.** Nor does it decide real risk tiers or approval
  policies for a real deployment — `schedulingRiskTiers` and
  `EXAMPLE_schedulingApprovalPolicy` are exactly as illustrative as
  every other domain's own versions.

## Resolved: optimistic concurrency check before commit

A human reviewer asked, after four domains had been wired into the
agentic layer, whether concurrency, ACID, and resource conservation
still held up — not as a rhetorical question, but pointing at
`act()` specifically. Reading `act.ts`, `shell.ts`,
`inMemoryShell.ts`, and `fileShell.ts` confirmed a real gap:
`act()` committed whatever `doOutcome` it was handed, computed
against a context snapshot that could be arbitrarily stale by the
time Act actually ran — the whole Plan→Do→Check→**approve**→Act
chain can span hours across a human-approval wait, and nothing
re-checked the world hadn't moved on in the meantime.

The reviewer explicitly asked for this to be proven empirically
*before* any fix was designed — the same discipline every other
finding in this document follows, just applied to a cross-cutting
concern instead of a single domain.

- **The proof came first, as its own commit.**
  `tests/agentic/shell/actStaleCommitRace.test.ts` originally asserted
  the *broken* behavior: two `ScheduleBooking` proposals for
  overlapping time on the same resource, both computed against the
  same starting snapshot, both accepted by `act()` — and the second
  commit silently erased the first's already-committed booking via a
  wholesale context replace, despite both audit records claiming
  `committed`. Only after that test passed (proving the bug, not
  hypothesizing it) was the fix designed.
- **The fix is a seam between Do and Act, not a change to the
  deterministic core.** `executeSequence`'s all-or-nothing contract,
  Plan's validation, and Check's rules needed nothing — `Verifier`
  (`verifier.ts`) only ever looks at a `PlanProposal` (instructions and
  rationale), never at context, so Check's already-computed `decision`
  can never go stale the way Do's context-dependent computation can.
  What was missing was optimistic concurrency control: re-derive the
  proposal's effect against the *actual* latest state immediately
  before writing, and fail safely rather than commit blindly if that
  recomputation disagrees with what was originally verified.
- **`ImperativeShell` gained `readLatest(): TCtx | undefined`.**
  `createInMemoryShell` tracks the most recently committed context
  directly; `createFileShell` delegates to the `readLatestContext`
  helper that already existed but that `act()` never called.
- **`act()` now re-derives what to commit, rather than trusting what it
  was handed.** `ActInput` gained `baselineContext` (the fallback for
  when `shell.readLatest()` reports nothing has ever committed — in
  that case "latest" and "baseline" are the same context by
  definition) and `reexecute` (typically
  `(ctx) => engine.executeSequence(ctx, proposal.instructions)`). Every
  commit path calls `reexecute(shell.readLatest() ?? baselineContext)`
  immediately before writing and commits *that* result, discarding the
  original `doOutcome` entirely once Check has passed. A failure there
  produces a new `CommitOutcome`, `'stale'` — nothing is written, and
  the audit record explains why, so the caller knows to re-propose
  rather than retry the same stale proposal unchanged.
- **Re-run against the very test that proved the bug, this time proving
  the fix.** The rewritten `actStaleCommitRace.test.ts` asserts the
  second proposal above now gets `'stale'`, not `'committed'` — the
  first booking survives untouched. A second case in the same file
  proves the fix isn't merely conservative: a proposal for a genuinely
  unrelated resource, computed from the same stale snapshot, still
  commits — using the *freshly recomputed* context (which correctly
  contains both bookings), not its own stale one, which alone would
  have erased the first booking on write exactly like the bug did.
- **This closes the race completely for a single process, not just
  narrows it.** Between `shell.readLatest()` and `shell.commit()`
  inside one `act()` call, there is no `await` — both are synchronous,
  and Node's single-threaded event loop cannot preempt synchronous code
  to run another `act()` call in between. So for `createInMemoryShell`,
  and for `createFileShell` under the single-writer-process assumption
  `docs/AGENTIC_LAYER.md` already scopes it to, there is no residual
  window left for this specific race. Multi-process coordination for
  `createFileShell` (two OS processes appending to the same files) was
  already out of scope before this fix and remains so — a different,
  already-documented problem this change does not attempt to solve.
- **Checked against ledger and bed's actual handlers, not assumed by
  analogy.** Both have the identical shape to scheduling's overlap
  check — `EntryAlreadyExists`/`BedAlreadyOccupied` were being checked
  against whatever snapshot Do happened to run against, not the shell's
  real state at commit time — so this fix protects them the same way,
  with no domain-specific code required. **Correction, not a silent
  edit: this was slightly overstated.** "The seam lives entirely in
  `act()`/`shell.ts`, below every domain" was only true for callers that
  actually go through `act()`/`actHuman()` — it missed that
  `core/io/relay.ts`'s outbox relay commits into the exact same stores
  through a second, parallel path that this fix never touched. See
  "Resolved: the outbox relay re-validates against reality before each
  commit" below for what closing that second path required.
- **What this doesn't prove:** that a real deployment's actual identity
  provider, LLM vendor, and approval-policy sign-off process are
  designed — those remain exactly as open as `docs/AGENTIC_LAYER.md`'s
  other open questions describe. Nor does this address multi-process
  file-shell coordination, encryption at rest, or retention — all
  already named as separate, undecided concerns.

## Resolved: imaging's agentic-layer integration

The fifth domain (after `lab`, `bed`, `ledger`, `scheduling`) to get
real agentic-layer integration.
`src/agentic/{risk,validation,verification,identity}/imaging.ts` supply
`imagingRiskTiers`, `imagingInstructionValidators`, `imagingVerifier`,
and `EXAMPLE_imagingApprovalPolicy`.

- **The first domain whose forward lifecycle has three steps, not two —
  so the tier split isn't a fixed ratio, it's four independent
  judgments that happened to land 3-and-1.** `OrderStudy` gets
  `'review-required'` (correctable via `CancelStudy`, the same shape
  `AdmitPatient`/`OrderLabTest` get that tier for). `CancelStudy` also
  gets `'review-required'`, checked against `cancelStudyHandler`
  directly: it only ever fires while a study is still `'ordered'`,
  before any image was captured or reported — the same "resolves a
  still-pending order, nothing clinical happened yet" shape
  `CancelLabOrder` has, even though (like `CancelBooking`/
  `ReverseEntry`) it permanently consumes the `studyId`. That fact
  alone was deliberately *not* treated as sufficient to force the
  higher tier here — see the next point for why that's not a
  contradiction of scheduling's reasoning, just a different instruction
  with a different actual consequence.
- **`RecordStudyStored` was seriously considered for the top tier and
  landed on `'review-required'` anyway — the interesting judgment call
  in this domain.** A wrong `storageRef` really could associate the
  wrong patient's images with a study, a genuine PACS/RIS safety
  hazard. What tips it below `ReportStudy` is a structural fact specific
  to imaging's own modeled lifecycle: a bad `RecordStudyStored` still
  has one more checkpoint downstream within this domain — the
  radiologist reading the images before writing `ReportStudy` — that
  has a real chance to catch a wrong-study mismatch before it reaches a
  clinical decision. `ReportStudy` has no such checkpoint; it *is* the
  clinical decision, the same terminal-consequence shape
  `ReportLabResult`/`DischargePatient` earn their own top tier for. This
  is the first domain where two *different* instructions were each
  independently checked against the top-tier bar, and only one of them
  actually cleared it.
- **`EXAMPLE_imagingApprovalPolicy`'s top tier is narrower than "any
  physician," not just narrower than its own lower tier.** Every prior
  domain's top tier used a generic `'physician'` (or a domain-specific
  replacement for it, like ledger's `'finance-controller'`). Imaging's
  is `'radiologist'` specifically — a referring physician can order or
  cancel a study (`'physician'` appears at `'review-required'`
  alongside the new `'radiologic-technologist'`), but signing the
  actual report is a radiologist's job, so `'physician'` is deliberately
  *not* repeated at `'approval-required'`.
  `tests/agentic/imaging/imagingAgenticPipelineEndToEnd.test.ts`'s third
  case proves it: `dr-wu` (`roles: ['physician']`) — sufficient for
  every prior domain's equivalent top-tier check — is still refused for
  `ReportStudy`.
- **Sixth real caller of the domain-agnostic verifier factories.**
  `imagingVerifier` composes the same three factories every other
  domain's verifier does.
- **Proven through the real chain, not just type-checked.**
  `imagingAgenticPipelineEndToEnd.test.ts` runs a raw, untrusted
  `OrderStudy` candidate through `toPlanProposal` →
  `imagingEngine.executeSequence` (Do) → `imagingVerifier` (Check) →
  `resolveApprovalForProposal` → `act()` to a real commit, plus a
  malformed-candidate rejection case and the narrower-than-physician
  case above.
- **What this doesn't prove:** at the time this section was written,
  nursing still had no agentic-layer integration — five of seven
  domains had it, one didn't. **Nursing has since been closed too —
  see below, which closes this gap completely.** Nor does it decide
  real risk tiers or approval policies for a real deployment —
  `imagingRiskTiers` and `EXAMPLE_imagingApprovalPolicy` are exactly as
  illustrative as every other domain's own versions.

## Resolved: nursing's agentic-layer integration

The seventh, and last, domain to get real agentic-layer integration —
this closes the gap the original synthesis question flagged
completely: every domain now has its own `RiskTierRegistry`,
`InstructionValidatorRegistry`, `Verifier`, and `ApprovalPolicy`.
`src/agentic/{risk,validation,verification,identity}/nursing.ts` supply
`nursingRiskTiers`, `nursingInstructionValidators`, `nursingVerifier`,
and `EXAMPLE_nursingApprovalPolicy`.

- **`GrantRole`'s top tier has the strongest justification of any
  domain so far, and it's a genuinely different kind of justification.**
  Every other domain's `'approval-required'` instruction is
  high-consequence *within that domain* (a wrong lab result, a wrong
  discharge, a wrong ledger reversal, a wrong imaging report). `GrantRole`
  is different: this domain's own committed state is exactly what a
  real `IdentityProvider` (`nursingIdentityProvider.ts`) derives *every
  other domain's* approval authority from. A wrongful grant doesn't
  just misstate a nursing fact — it can hand out the permission that
  gates `DischargePatient`, `ReportLabResult`, `ReverseEntry`,
  `CancelBooking`, or `ReportStudy` anywhere else in the codebase. There
  is also, deliberately, no `RevokeRoleGrant` instruction at all (see
  `types.ts`'s own doc comment), so `GrantRole` is unambiguously
  terminal within this domain. `IssueCredential`/`RevokeCredential`
  both stay at `'review-required'`: a wrongful revoke doesn't disturb
  any grant already made (role grants are validated once, at grant
  time, and stay valid even if the backing credential is later revoked
  — real institutional credentialing works this way), so it only blocks
  *future* grants until a fresh credential is issued — an operational
  nuisance, not the "wrong value drives a wrong clinical decision"
  shape that would earn it the top tier.
- **`EXAMPLE_nursingApprovalPolicy` deliberately returns to a *nested*
  tier shape, in explicit contrast to scheduling's disjoint one.**
  `'chief-medical-officer'` is a superset of `'review-required'`'s
  authority (the same "narrower list at the higher tier" shape
  `patient`/`lab`/`ledger`/`imaging` all use), not a stranger to it the
  way scheduling's `'or-director'` is to `'scheduling-coordinator'`.
  Both shapes are legitimate; which one fits depends on whether a
  domain's real-world roles actually nest (a CMO's authority genuinely
  subsumes a credentialing officer's) or don't (an OR director's
  doesn't subsume a scheduling coordinator's) — not on any property of
  `resolveApprovalForProposal` itself, which was already shown not to
  assume either shape.
- **The first domain whose own agentic pipeline was proven against its
  own real committed state, not a hand-maintained identity list.**
  Every other domain's end-to-end test used
  `createInMemoryIdentityProvider` with a fixed roster.
  `nursingAgenticPipelineEndToEnd.test.ts`'s second case instead builds
  a `NursingContext` and feeds the *same* context to both
  `nursingEngine.executeSequence` (as the baseline/latest state a
  `GrantRole` proposal is checked against) and
  `createNursingIdentityProvider` (as what the approver's own identity
  resolves from) — closing, for nursing's own instructions specifically,
  the loop `nursingIdentityProvider.ts`'s doc comment already closed
  for *patient's* instructions in
  `nursingIdentityProviderApprovalFlow.test.ts`. The same test also
  proves a real, known `credentialing-officer` — not an unknown
  approver — is still correctly refused for `GrantRole`'s tier.
- **Seventh, and last, real caller of the domain-agnostic verifier
  factories.** `nursingVerifier` composes the same three factories
  every other domain's verifier does — `createMaxBatchSizeVerifier`,
  `createRationalePiiScanVerifier`, and `createRiskTierVerifier` have
  now been independently exercised by all seven domains, not just
  `patient`.
- **What this doesn't prove:** that a real deployment's actual identity
  provider, LLM vendor, real risk tiers, and approval-policy sign-off
  process are designed — every `EXAMPLE_*ApprovalPolicy` and every
  domain's risk tiers remain exactly as illustrative as `patient`'s own
  versions always were. Nor does closing this gap address either of
  the other two gaps the original synthesis question named: a
  human-initiated `ImperativeShell` path still doesn't exist (see
  docs/ARCHITECTURE.md and docs/AGENTIC_LAYER.md), and, at the time
  this section was written, `patientToScheduling.ts` was still
  missing. **That's since been closed too — see below.**

## Resolved: patientToScheduling.ts

The second of the original synthesis question's three named gaps to
close (after all seven domains' agentic-layer integration).
`CancelBooking` already existed in scheduling — this was the
"shovel-ready" gap: nothing invoked it on discharge yet.
`src/integration/patientToScheduling.ts` mirrors `patientToLab.ts`/
`patientToImaging.ts` exactly in shape: no reaction to
`EncounterAdmitted` (a booking is made by an explicit scheduling
instruction, never implied by admission — the same reasoning
recurring a third time, genuinely, not by rote), and `EncounterDischarged`
cancels every still-`'scheduled'` booking found for that encounter,
one-to-many.

- **The one genuine difference from lab/imaging, surfaced by actually
  reading `scheduling/types.ts` rather than assuming the analogy held.**
  Lab's `LabOrderRecord.encounterId` and imaging's `StudyRecord.encounterId`
  are both branded `EncounterId` foreign keys. Scheduling's
  `BookingRecord.subjectId` is a plain `string`, deliberately kept
  generic — a booking's subject might be a patient's procedure, but
  might just as well be equipment maintenance or a staff shift, neither
  of which has an encounter at all. `src/integration/schedulingLookup.ts`'s
  `findPendingBookingsForEncounter` can only match on `subjectId`
  equality, a convention-based link, not a type-enforced one — nothing
  in scheduling's own types stops a caller from putting something other
  than an `EncounterId` in `subjectId`. `patientToScheduling.test.ts`
  exercises this directly: a booking whose `subjectId` is
  `'quarterly-maintenance'` is correctly left alone on discharge,
  proving the weaker link doesn't accidentally cancel bookings that were
  never about an encounter at all.
- **Redelivery-safe and best-effort, for the same reasons as every
  prior choreography reaction.** `findPendingBookingsForEncounter` is
  lookup-driven, not selection-driven (unlike `bedLookup.ts`'s
  `findBedHoldingEncounter`, which needed a redelivery-safety check for
  `EncounterAdmitted`'s bed-selection side), so re-delivering the same
  discharge after some bookings are already cancelled naturally finds
  only the ones still `'scheduled'`. One booking failing to cancel
  doesn't block the rest, the same `patientToLab.ts`/`patientToImaging.ts`
  contract.
- **What this doesn't prove:** at the time this section was written, no
  durable outbox relay existed yet for scheduling —
  `patientToLab.ts`/`patientToImaging.ts` both eventually got one
  (`outboxRelayLab.ts`/`outboxRelayImaging.ts`), built as a deliberately
  separate, later step each time; the same was true here too, at first.
  **`outboxRelayScheduling.ts` has since closed that too — see the
  final section below.** Nor did this address the remaining gap from
  the original synthesis question — a human-initiated `ImperativeShell`
  path still didn't exist. **That's since been closed too — see below,
  which closes the original synthesis question's three named gaps
  completely.**

## Resolved: the human-initiated ImperativeShell path

The third, and last, of the original synthesis question's named gaps.
docs/ARCHITECTURE.md and docs/AGENTIC_LAYER.md both flagged the same
thing: nothing wired a directly human-issued instruction's `Do` output
through an `ImperativeShell` — only `act()`, the agentic layer's own
Act stage, ever committed anything. `src/human/actHuman.ts` is that
missing counterpart.

- **Deliberately does not reuse Plan, `toPlanProposal`, or any
  `Verifier` — and the reason is the same reason every one of those
  exists in the first place.** `toPlanProposal`'s untrusted-JSON gate,
  `combineVerifiers`'s PDPA rationale scan, batch-size rule, and
  risk-tier rule all exist to compensate for an AI proposal having no
  inherent authority of its own. A human directly issuing an
  instruction already *is* the authority, once their identity and role
  are confirmed — there's no LLM-authored rationale to scan, no
  legitimate-large-order-set-vs-suspicious-AI-batch distinction to
  make, and no separate "Check, then wait for a human" step, because
  the human is already the one calling this function. Building
  `actHuman()` as a thinner, parallel path rather than routing human
  instructions through the AI-shaped pipeline is itself the finding:
  the two are genuinely different kinds of input, not the same shape
  wearing different clothes.
- **Reuses the identity/role-checking machinery instead of duplicating
  it, because the underlying question is the same one.**
  `resolveActorForInstructions` (`agentic/identity/`) is the
  human-path counterpart to `resolveApprovalForProposal` — same
  `RiskTierRegistry`/`ApprovalPolicy` lookup, same `resolveApproval`
  underneath, because "who may approve X" and "who may directly issue
  X" are the same real-world authority question in every domain
  modeled so far (a physician who can approve a discharge is also the
  one who orders it directly). It takes `instructions` directly rather
  than a `PlanProposal`, since there is no proposal here to key off of.
- **`ImperativeShell` gained a fourth, defaulted type parameter so
  `actHuman()` could supply its own audit-record shape without
  disturbing a single existing call site.** `TAuditRecord = AuditRecord<TInstruction, TEffect>`
  on `ImperativeShell`, `createInMemoryShell`, and `createFileShell` —
  confirmed empirically, not just by inspection: `npm run typecheck`
  and the full suite passed unchanged immediately after this change,
  before any new human-path code existed, proving every 3-type-argument
  call site really does keep compiling as-is.
- **`HumanActionAuditRecord` is a genuinely distinct type from
  `AuditRecord`, not the same shape with placeholder fields.** No
  `proposal.rationale`/`modelVersion`/`promptVersion`/`decision` —
  none of that exists when a human issues an instruction directly, and
  forcing values like `modelVersion: 'human'` into `AuditRecord`'s
  shape would misrepresent what happened rather than describe it.
  `HumanActionOutcome` also has no `'awaiting-approval'` (nobody is
  waiting on a separate approver in this path) and no `'stale'` (unlike
  `act()`, `actHuman()` only ever calls `reexecute` once, immediately
  before commit, against the freshest state — there is no earlier,
  possibly-stale computation for a later failure to contradict, so a
  plain `'rejected'` already says everything there is to say).
- **The same optimistic-concurrency close `tests/agentic/shell/actStaleCommitRace.test.ts`
  proved necessary for `act()` applies here too, and is proven the same
  way.** `actHuman()` re-derives what to commit from
  `shell.readLatest() ?? baselineContext` immediately before writing,
  exactly like `act()`. `tests/human/actHuman.test.ts`'s fourth case
  proves it concretely: a commit made directly against the shell after
  a caller's `baselineContext` was taken still gets correctly detected
  and rejected, not silently overwritten — nothing about being
  human-initiated makes this path immune to the same race the agentic
  path needed fixing for.
- **Proven through a second real caller of `createFileShell`, not just
  the in-memory stand-in.** `tests/human/actHumanFileShellIntegration.test.ts`
  runs `actHuman()` against the exact same `createFileShell` `act()`
  already uses in `fileShellActIntegration.test.ts` — just with
  `HumanActionAuditRecord` as its `TAuditRecord` — proving `shell.ts`'s
  own long-standing claim ("nothing about `ImperativeShell` cares
  where a commit came from") empirically, for the first time, rather
  than leaving it asserted.
- **What this doesn't prove:** whether the agentic and human-initiated
  paths should ever share one *audit* store, not just the same shell
  *mechanism* — considered and deliberately not built here (it would
  mean changing `AuditRecord` and every existing agentic test), and
  remains open in docs/AGENTIC_LAYER.md. Nor does this model any real
  authentication, session, or HTTP boundary a human's instruction would
  actually arrive through — `docs/ARCHITECTURE.md` already scopes "no
  HTTP/API layer" out entirely, unchanged by this. This closes the
  original synthesis question's three named gaps completely: all seven
  domains have agentic-layer integration, `patientToScheduling.ts`
  exists, and a human-initiated `ImperativeShell` path now exists too.

## Resolved: nursing identity resolution reads fresh, not from a frozen snapshot

Asked whether the last two domains (imaging, nursing) needed anything
further reinforced in the core foundation layer, on top of the OCC fix
above. Imaging checked out clean by direct inspection of its own four
handlers. Nursing had a real, different gap: `createNursingIdentityProvider`
took a frozen `NursingContext` snapshot, and nothing stopped a caller
from resolving an approval against one that had gone stale relative to
nursing's real, current state — the OCC fix above cannot catch this,
because it re-validates the domain *being committed to*, not the
freshness of an `IdentityProvider` a caller already has in hand before
`act()`/`actHuman()` is even called.

- **The proof came first, as its own commit, the same discipline every
  finding in this document follows.**
  `tests/agentic/identity/nursingIdentityProviderStaleness.test.ts`
  originally asserted the gapped behavior: a physician's credential
  revoked in nursing's real, current state was still honored by an
  `IdentityProvider` built from an earlier snapshot. Only after that
  test passed (proving the gap, not hypothesizing it) was the fix
  designed.
- **The fix mirrors the OCC fix's own shape exactly: stop trusting an
  already-computed value, force a fresh read at the moment of use.**
  `createNursingIdentityProvider` now takes a
  `readNursingContext: () => NursingContext` callback instead of a
  frozen value, calling it inside `resolve()` on every call rather than
  once at construction time. A real deployment wires this as something
  like `() => readLatestContext(nursingCommitsFile) ?? emptyNursingContext` —
  the same "recompute against reality immediately before the moment
  that matters" move `act()`'s `reexecute` already makes for commits.
- **Every existing call site needed the same mechanical change, and
  none needed more than that.** `nursingIdentityProvider.test.ts`,
  `nursingIdentityProviderApprovalFlow.test.ts`, and
  `nursingAgenticPipelineEndToEnd.test.ts` all previously passed a
  frozen `NursingContext` value directly; each now wraps it in a thunk
  (`() => context`) that still returns the same object every time,
  since none of those tests needed the context to actually change
  mid-test — confirming the fix is additive to the *contract*, not
  disruptive to what every existing caller was already doing.
- **Re-run against the very test that proved the gap, this time proving
  the fix — without reconstructing the provider.** The rewritten
  `nursingIdentityProviderStaleness.test.ts` builds one
  `IdentityProvider` backed by a mutable binding, resolves an approval
  successfully, revokes the credential by reassigning that binding to
  the post-revocation context, and resolves again against the *same*
  provider instance — which now correctly refuses it. Proving the fix
  works without ever calling `createNursingIdentityProvider` a second
  time is what actually demonstrates `resolve()` reads fresh each call,
  rather than merely showing that reconstructing the provider would
  have picked up new state (which a frozen snapshot could already do
  trivially, and would have proven nothing).
- **What this doesn't prove:** that a real deployment actually wires
  `readNursingContext` to something that reads real, persisted state on
  every call — this fix makes that possible and removes the trap of a
  frozen snapshot, but a caller could still hand it a closure that
  captures a value once and returns it forever, which would reintroduce
  the identical gap at the call site instead of inside this function.
  Nor does this address whether other identity providers (a future SSO/
  LDAP-backed one) need the same discipline — real directories are
  inherently live queries with no separate snapshot step, so this
  specific trap is particular to a provider backed by this codebase's
  own committed state, which today is only `createNursingIdentityProvider`.

## Resolved: outboxRelayScheduling.ts

The last of the small, already-named loose ends: `patientToLab.ts` and
`patientToImaging.ts` had each eventually gotten a durable outbox
relay (`outboxRelayLab.ts`/`outboxRelayImaging.ts`) as a deliberately
separate, later step after their in-process choreography landed;
scheduling's own `patientToScheduling.ts` had not yet, until now.
`src/integration/outboxRelayScheduling.ts` mirrors
`outboxRelayImaging.ts` exactly — a thin wrapper around
`core/io/relay.ts`'s already-domain-agnostic `relayEffects` loop, the
same wrapper shape bed/lab/imaging each already proved needs no
changes to that loop itself.

- **Nothing new to prove about `relayEffects` — this call site is
  purely mechanical, and that's the point.** `relayEffects` was already
  confirmed domain-agnostic by lab and imaging each being a second and
  third real caller with genuinely different reaction shapes (lab: no
  selection strategy at all; imaging: cancel-pending one-to-many).
  Scheduling's `react` closure (`reactToPatientEffectsForScheduling`)
  has the identical one-to-many, no-selection-strategy shape imaging's
  already has, so writing this wrapper required zero changes to
  `relayEffects`, `RelayResult`, or `EffectCommitter` — confirmed by
  running the full suite immediately after, not just expected by
  analogy.
- **The `subjectId`-vs-`EncounterId` weaker link
  (`schedulingLookup.ts`) carries through the relay unchanged, and is
  exercised there too, not just in the in-process reaction.**
  `outboxRelayScheduling.test.ts`'s fourth case relays a durably
  committed discharge against a `SchedulingContext` containing only a
  `'quarterly-maintenance'`-`subjectId` booking — unrelated to any
  encounter — and confirms it's left untouched even when the discharge
  arrives through the durable relay path, not just the direct
  in-process one `patientToScheduling.test.ts` already covered.
- **What this doesn't prove:** that a real deployment actually wires
  this relay to run on a schedule, a queue trigger, or any other real
  delivery mechanism — `relayEffects` and its wrapper are the delivery
  *logic*, not a deployed job; the same gap every other relay in this
  codebase already has. At the time this section was written, that was
  the last of the concrete, already-named gaps this document's
  agentic-layer/choreography arc opened with. **A proactive sweep for a
  different, related pattern then found one more — see below.**

## Resolved: the outbox relay re-validates against reality before each commit

A proactive, codebase-wide sweep for the same "frozen value trusted at
the wrong moment" pattern the OCC fix and the nursing-identity fix each
closed — requested after both had been found by asking a narrower
question twice — surfaced a real gap in `core/io/relay.ts`'s
`relayEffects`, the domain-agnostic loop underneath every
`outboxRelay*.ts` wrapper (bed/lab/imaging/scheduling). It committed
via a plain `EffectCommitter` — `commit()` only, no `readLatest()` — so
it never re-validated against the target domain's actual latest
committed state before writing, even though at least one domain (bed)
has a second, independent writer into the exact same commit log: direct
`AssignBed`/`ReleaseBed` through the agentic/human pipeline, which *is*
OCC-protected. The relay predates the OCC fix entirely and was never
brought under it.

- **The proof came first, as its own commit, the same discipline every
  finding in this document follows.**
  `tests/integration/outboxRelayStaleCommitRace.test.ts` originally
  asserted the *broken* behavior: a direct `AssignBed` for encounter-5
  landing before the relay processes a new admission for encounter-1,
  and the relay's stale, internally-threaded context still believing
  the same bed was free — reassigning it and committing a
  whole-context replacement that silently erased encounter-5's real,
  already-committed occupancy. Only after that test passed (proving the
  gap, not hypothesizing it) was the fix designed.
- **The fix mirrors the OCC fix's own shape exactly: stop trusting an
  already-computed value, force a fresh read at the moment of use —
  now applied to a loop that can commit more than once per call, not
  just a single commit.** `EffectCommitter` (and all four wrapper
  interfaces, `BedCommitter`/`LabCommitter`/`ImagingCommitter`/
  `SchedulingCommitter`) now require `readLatest(): TTargetCtx | undefined`.
  Inside `relayEffects`'s loop, each iteration now computes
  `targetCommitter.readLatest() ?? context` and reacts against *that*,
  not the context threaded forward from the previous iteration —
  falling back to the threaded value only when nothing has ever been
  committed yet, the same `baselineContext` role `act()`'s own fix
  established.
- **Confirmed structurally free, not just cheap, because the interface
  was already there — this is why widening `EffectCommitter` broke
  nothing.** `createFileShell` and `createInMemoryShell` both already
  had `readLatest()` from the original OCC fix; every existing test
  caller of every `outboxRelay*.ts` wrapper already passes one of those
  two, not a hand-rolled minimal object. Verified empirically, in
  sequence: widening `EffectCommitter`'s type alone (before touching
  `relayEffects`'s loop) left the entire suite passing unchanged, and
  only the deliberately-planted proof test failed once the loop itself
  was rewritten to actually call `readLatest()` — isolating exactly
  which change did what, rather than changing both at once and hoping.
- **Re-run against the very test that proved the bug, this time proving
  the fix, plus a second case proving the fix isn't merely
  conservative.** The rewritten `outboxRelayStaleCommitRace.test.ts`
  asserts the relay now correctly assigns encounter-1 to bed-2 instead
  of bed-1, and that *both* assignments — encounter-5's direct one and
  encounter-1's new one — survive in the committed state, not just that
  nothing got overwritten. A second case commits direct assignments to
  *both* beds before the relay runs and confirms it correctly reports
  `no-bed-available` rather than either overwriting anything or
  papering over a genuine conflict.
- **A prior claim in this same document — that the OCC fix "protects
  \[ledger and bed] the same way... the seam lives entirely in
  `act()`/`shell.ts`, below every domain" — was corrected in place
  above, not silently edited,** once this section made clear that
  claim was true only for callers going through `act()`/`actHuman()`,
  not for the relay's own, separate commit path into the same stores.
- **What this doesn't prove, at the time this section was first
  written:** `src/integration/externalLabResultAdapter.ts`'s
  `ingestExternalLabResult` had the identical shape — it committed via
  the same widened `LabCommitter` interface but was not itself changed
  to call `readLatest()`, and lab has at least three independent
  writers (the agentic pipeline, `outboxRelayLab.ts`, and this adapter)
  into the same `labCommitsFile`. **That's since been closed too — see
  immediately below.**

### Follow-up: externalLabResultAdapter.ts fixed the same way

Same root cause, proven and fixed in a direct follow-up rather than
left as a standing suspicion.

- **Proven first, exactly the same discipline.**
  `tests/integration/externalLabResultAdapter.test.ts` gained a case
  asserting the *broken* behavior: a direct `CancelLabOrder` for
  order-2 lands, entirely unrelated to an external HL7-shaped result
  message about order-1 that arrives next — but the message is
  ingested against a `labContext` argument that predates the
  cancellation. The bug: `ingestExternalLabResult`'s commit, built from
  that stale context, silently reverted order-2 back to `'ordered'`.
  Run alone before any fix, this case failed exactly as predicted
  (`expected 'ordered' to be 'cancelled'`) — confirming the gap, not
  assuming it from the relay's analogous shape.
- **The fix is one line, mirroring the relay's exactly.**
  `ingestExternalLabResult` now reacts against
  `labCommitter.readLatest() ?? labContext`, not `labContext` directly.
  `LabCommitter` already required `readLatest()` from the relay fix, so
  no interface change was needed here — only the two real callers
  (`tests/integration/externalLabResultAdapter.test.ts`'s
  `recordingCommitter()`, which had to start tracking and exposing the
  latest committed context to keep satisfying the now-real requirement)
  needed updating.
- **What this doesn't prove, at the time this section was first
  written:** that every future caller of `commit()`-shaped interfaces
  in this codebase has been swept for the same pattern — this and the
  relay fix closed the two instances a proactive sweep actually found
  and named; a new caller built later could still reintroduce the same
  shape if it commits without reading latest first. Nothing here added
  a structural guard against that — the fix was per-caller discipline,
  applied twice, not a mechanism that made the mistake impossible to
  write a third time. **A custom lint rule closes exactly that gap —
  see below.**

## Resolved: a lint rule enforces the readLatest()-before-commit() discipline

Both the OCC fix and its `externalLabResultAdapter.ts` follow-up were
per-caller discipline, applied by hand, twice — exactly the shape of
mistake that tends to get reintroduced a third time by someone who
never read either "Resolved" section. `eslint-rules/no-commit-without-fresh-read.js`,
wired into a new `eslint.config.js` (this codebase's first lint
infrastructure at all — introduced specifically for this rule, not a
general adoption of a linting standard), makes it a build-time error
for any function to call `.commit(...)` on a value shaped like
`{ commit(...): void; readLatest(): ... }` without that same function
also calling `.readLatest()` on the same receiver somewhere.

- **A presence check, not an ordering or dataflow proof — and getting
  that distinction right took an actual failed attempt, not just
  foresight.** The first version of the rule tried to check that
  `readLatest()` appeared *earlier in the source* than the matching
  `commit()` call, and it produced false positives on `act()` and
  `actHuman()` — both real, already-correct code. The reason:
  `finalize`'s `.commit()` call sits in a small closure *defined*
  before `commitAfterFreshCheck`'s `.readLatest()` call in the source
  text, even though every path that actually reaches a commit calls
  `commitAfterFreshCheck` (and therefore `readLatest()`) first at
  runtime — source position and execution order aren't the same thing
  once closures are involved, and this codebase's own style leans on
  exactly that shape. Proving true execution order would need real
  control-flow analysis; the rule now just checks *presence* anywhere
  in the same outermost enclosing function, which is all "was
  `readLatest()` forgotten entirely" — the actual shape of both real
  bugs — ever needed.
- **The boundary has to be the *outermost* enclosing function, not the
  innermost, for the same reason.** `act()`/`actHuman()` call
  `.commit()` from inside `finalize` and `.readLatest()` from inside a
  *different* nested closure (`commitAfterFreshCheck`) — neither one
  calls both itself, only their shared outer function does. The rule
  walks up every ancestor function and keeps the outermost one as the
  boundary, specifically so this shape checks out.
- **Proven against both a deliberately broken case and the real
  codebase, not just assumed to work.** A throwaway scratch file with
  a `badCommit` (commits without ever calling `readLatest()`) and a
  `goodCommit` (does) confirmed the rule flags exactly the first and
  not the second, before it was trusted against real source — then
  `npm run lint` against the actual codebase came back clean, covering
  all four real call sites (`act()`, `actHuman()`, `relayEffects()`,
  `ingestExternalLabResult()`).
- **What this doesn't prove:** that the rule catches every conceivable
  variant of the mistake — it only recognizes a direct
  `identifier.commit(...)`/`identifier.readLatest()` call shape (not,
  say, a destructured `{ commit } = committer` or a re-exported
  wrapper function that calls `commit()` on a parameter passed through
  from elsewhere), and it only fires for receivers whose *type*
  structurally has a `readLatest` property, so a committer-shaped
  object typed as `unknown` or `any` at the call site would slip past
  it. It also doesn't (and structurally can't, without real
  control-flow analysis) prove `readLatest()` actually runs before
  `commit()` on every path — only that the author didn't forget it
  entirely. `eslint.config.js` type-checks against `tsconfig.json` and
  is scoped to `src/**/*.ts` only, matching `npm run typecheck`'s own
  scope — test files are not covered, so a test's own hand-rolled fake
  committer (like `externalLabResultAdapter.test.ts`'s
  `recordingCommitter()`) is not linted, only real source callers are.

**Follow-up: wired into a `pre-commit` hook, not just run on demand.**
`npm run lint` catching the mistake is only as good as someone
remembering to run it — the same "per-caller discipline" gap this rule
exists to close in the first place. `husky` (this codebase's first
git-hook tooling, same "introduced specifically for this need" scoping
as `eslint` itself) now runs `npm run lint && npm run typecheck && npm test`
in a `.husky/pre-commit` hook, version-controlled so every clone of
this repository gets it via `npm install`'s `prepare` script, not just
this one local checkout. `&&`-chained deliberately, not one command per
line: a plain shell script's exit code is only its *last* command's,
so without chaining (or `set -e`), a lint failure followed by a
passing typecheck/test would leave the overall hook exiting `0` and
the commit would go through anyway — silently defeating the whole
point. Proven twice, not assumed: staging a deliberately reintroduced
copy of the `badCommit` scratch case and running the hook directly
confirmed it stops at the failing lint step without ever reaching
typecheck or test, and a real `git commit` attempt with the same
scratch case staged was actually rejected
(`husky - pre-commit script failed (code 1)`, commit never created,
confirmed against `git log`) before either was trusted and the scratch
file removed again.

**Follow-up: the same check now also runs in CI, not just locally.** A
`pre-commit` hook only protects commits made from a checkout where it's
actually installed — `git commit --no-verify`, a commit made from a
tool that skips hooks, or (until now) anything pushed straight to a
remote all bypass it entirely. `.github/workflows/ci.yml` runs
`sh .husky/pre-commit` directly on every push and pull request, rather
than re-declaring `lint && typecheck && test` a second time — one
script is the single source of truth for "what has to pass," so the
local hook and CI can never drift out of sync with each other by
someone updating one and forgetting the other. Verified locally before
trusting the workflow file, not just written and assumed correct:
`npm ci` (a clean install from `package-lock.json`, the same command
CI runs, not `npm install`) followed by `sh .husky/pre-commit` — the
exact two steps the workflow performs — passed end to end.

## Resolved: replay determinism and bounded allocation, made explicit

Everything above proves determinism *by absence* — no caller has ever
been caught reaching for `Date.now()`, `Math.random()`, or ambient I/O.
That's a real guarantee (the guard test would fail the moment it
stopped being true), but it's an inference from "nothing forbidden was
found," not a demonstration of the actual property anyone building a
second domain's core on this pattern cares about: replay a fixed
instruction log on different hardware, at a different time, and get
back the exact same state and effects, every time. Two gaps closed:

- **A typed vocabulary for "ordering without a clock."**
  `src/core/temporal.ts` already had `IsoTimestamp` — a branded string
  instructions carry as data, never something a handler generates by
  observing the system clock. It had no equivalent for *pure ordering*
  ("this happened before that," with no duration or wall-clock value
  attached), which left "count on the array index of an instruction
  batch" as the only option, with nothing stopping a future need from
  reaching for a real timestamp to fill that role instead — exactly the
  ambient-time smell this whole pattern exists to keep out. `Tick`
  (`temporal.ts`) is that missing type: a branded integer logical
  sequence number, assigned and passed in by a caller exactly like
  `IsoTimestamp` is — not a `Clock` service object with a `.now()`
  method, which `docs/ARCHITECTURE.md`'s "Determinism is a convention"
  section already explicitly bans from `ExecutionContext` (an injected
  service with methods breaks JSON-serializability and is a disguised
  way to smuggle ambient calls back in). `Tick` has no consumer yet in
  this codebase — it is infrastructure for the next domain or the next
  ordering need, sitting next to `IsoTimestamp` so reaching for a real
  clock to express "before/after" stops being the path of least
  resistance.
- **The two guard gaps a determinism review actually found.**
  `determinism.guard.test.ts`'s banned-pattern list covered `Date.now`,
  `new Date`, and `Math.random`, but not `performance.now()` or
  `process.hrtime()` — both exactly as replay-breaking as `Date.now()`,
  just a different precision/API, and neither was actually present in
  the codebase, but neither would have been *caught* if someone added
  one. Same for `setTimeout`/`setInterval`: a handler whose effect
  depends on event-loop scheduling is non-deterministic one level
  removed from reading a clock directly. All four are now banned
  identifiers in the same guard.
- **Replay determinism proven by running it, not just by the absence
  of banned calls.** `tests/core/engine.replay.test.ts` runs the same
  instruction log through `executeSequence` against a fresh context
  five independent times and asserts every run is deep-equal to the
  first — the actual "same input log, replayed, produces identical
  output" claim, checked directly, on the generic `counterEngine`
  fixture (`tests/core/fixtures/counterEngine.ts`) that already existed
  for exercising the execution core in isolation from any one domain.

**Why memory is bounded without a fixed-capacity buffer, ring buffer,
or object pool — and why none of those three were built.** The
execution core is ordinary garbage-collected TypeScript: each handler
call returns a freshly allocated `{ context, effects }` (never
mutating its input, per `outcome.ts`), and `executeSequence` grows one
`effects` array per call via `.push(...)`. A literal `ArrayBuffer`-
backed arena or cache-line-aligned static buffer was considered and
rejected — TypeScript/Node.js has no mechanism to control memory
layout that specifically, and building one would still sit inside a
V8 heap the runtime GCs regardless, so it would add real complexity for
no actual determinism or safety gain. What "bounded, not unbounded"
allocation means concretely here instead:

- **Every handler call allocates O(1)** — a fixed, small number of
  object literals per instruction, never a number that scales with
  anything external. `tests/core/engine.replay.test.ts`'s
  `it.each([1, 10, 100, 2000])` case proves the `effects` array
  `executeSequence` builds has exactly one entry per instruction at
  every one of those sizes — linear in the input, never super-linear,
  and never duplicated or leaked across repeated calls against the
  same engine instance.
- **A batch-size ceiling already exists exactly where it should, and
  deliberately not where it shouldn't.** An AI-sourced `PlanProposal`
  is capped by `createMaxBatchSizeVerifier` before it ever reaches
  `act()`/`executeSequence` — see `tests/agentic/verification/batchSizeRule.test.ts`.
  `executeSequence` itself was deliberately *not* given a matching hard
  ceiling: `src/human/actHuman.ts`'s own doc comment already explains
  why a human directly issuing instructions is exempt from every
  AI-proposal-specific check, batch size included — "no batch-size
  heuristic that should apply to a legitimate large order set the way
  it should to an AI proposing suspiciously many actions at once."
  Adding a cap inside the shared engine would have silently overridden
  that already-deliberate call for both paths at once; the ceiling
  belongs, and stays, one layer up, only on the path that actually
  needs it.
- **Object pooling was considered and rejected for a correctness
  reason, not a performance one.** Reusing a mutable buffer across
  calls would mean a handler mutating a previous call's leftover state
  before overwriting it — directly contradicting `outcome.ts`'s "never
  mutated" contract that every replay/audit guarantee in this document
  depends on. A subtle pool-recycling bug (a stale field surviving into
  the next call) would be exactly the kind of silent, hard-to-reproduce
  correctness bug this whole pattern exists to make impossible, in
  exchange for GC pressure this system has no measured problem with.
  Bounding *what comes in* (the verifier above) is the safe way to
  bound allocation; reusing *what's already been allocated* is not.

## Resolved: `tsconfig.json` never actually typechecked `tests/`

`npm run typecheck` was `tsc --noEmit` against `tsconfig.json`, whose
`include` has always been `["src"]` — meaning every file under `tests/`
was compiled and executed by `vitest run` (via esbuild, which strips
TypeScript types without verifying them) but never actually typechecked
by anything, ever. A type error inside a test could exist indefinitely
without ever failing CI, the pre-commit hook, or a local
`npm run typecheck` — the "the lint rule turned a convention into
something CI actually checks" discipline this whole document repeatedly
applies to *runtime* behavior had a real gap on the *type-safety* side
that nothing had checked until now.

- **Confirmed by fixing it, not by inspecting the config and assuming
  the gap was real.** A `tsconfig.typecheck.json` (`extends
  ./tsconfig.json`, `rootDir: "."`, `noEmit: true`, `include: ["src",
  "tests"]` — a separate file rather than widening `tsconfig.json`
  itself, so the real `npm run build`'s exact settings, including
  `declaration: true`'s additional emit-validity checks, stay
  untouched) surfaced 31 genuine, previously invisible errors the
  moment it existed. `npm run typecheck` now runs both: `tsc --noEmit`
  (unchanged — the original exhaustiveness gate, at the original
  settings) `&&` `tsc -p tsconfig.typecheck.json` (the new coverage) —
  the same "chain, don't replace" reasoning `.husky/pre-commit` already
  uses for `lint && typecheck && test`, so neither check's failure can
  be masked by the other passing.
- **Most of the 31 errors were the exact, already-solved,
  already-documented problem `src/instructions/patient/engine.ts`'s own
  comment names — just never applied where it also mattered.**
  `createEngine`/`planWithRetries`/`createFileShell` all take a
  mapped-type parameter (`HandlerRegistry`, `InstructionValidatorRegistry`)
  or carry generics with no argument to infer them from at all
  (`createFileShell(paths)`); TypeScript's inference through a mapped
  type's generic key falls back to the bare `Kinded` constraint (or
  `unknown`) instead of the concrete instruction union, silently
  producing a *looser*, wrong type rather than an error at the
  declaration site — the error only surfaces later, wherever the
  now-too-loose value gets used somewhere stricter. `patient/engine.ts`
  already carries a comment explaining exactly this and fixing it with
  explicit type arguments; `tests/core/fixtures/counterEngine.ts`'s
  `createEngine(counterHandlerRegistry)` had the identical shape and
  the identical bug, just never checked. Every `planWithRetries(...)`
  call feeding a CDSS-sourced proposal through Do/Check (three call
  sites pre-existing in `cdssPlanningEndToEnd.test.ts`, two more in
  this session's own `cdssPlanningThroughVerificationSpineEndToEnd.test.ts`
  and `auditTimeline.test.ts`, which had copied the same, already-broken
  pattern faithfully) had the same root cause and the same fix.
- **One genuine test bug this caught, not just a missing type
  annotation.** `verificationWorker.test.ts`'s "one proposal's failing
  check does not block a later proposal" test built its intermittent
  worker by passing an `async verify()` to `verifierAsWorker` — the
  adapter documented and built specifically for wrapping a *synchronous*
  `Verifier` (see "Resolved: a genuinely async VerificationWorker,
  proven non-blocking"). It worked at runtime purely because JavaScript
  doesn't enforce the distinction; the fix constructs a
  `VerificationWorker` directly instead, the same way
  `createExternalVerificationWorker` does for a real external call.
  This is exactly the kind of misuse `npm run typecheck` running against
  `tests/` exists to catch before it's copied into a third test as
  established style.
- **Nothing about runtime behavior changed.** All 428 tests passed
  before and after every fix in this section — every error was a type
  the test's actual runtime values already satisfied (or, for the
  `verifierAsWorker` misuse, one JavaScript's lack of static checking
  papered over). This was a type-safety net gap, not a correctness bug
  in anything already shipped.

## Resolved: Generative UI as a third instance of the same containment pattern

This document's own thesis (see "The thesis" at the top) is that a
deterministic foundation layer's job is making an LLM's hallucination
and non-deterministic output *structurally incapable of reaching
committed, consequential state* — and that different domains can have
completely different "hard cores" (state/time-precision, conservation,
feasibility) while still being instances of the same pattern. Generative
UI turns out to be a fourth "hard core," not previously named: **render
safety** — an Agent's output must be structurally incapable of reaching
a clinician's screen as free-form, unvalidated HTML/JSX. The user
supplied three guardrails for this (component registry, runtime
validation, deterministic action UI, strict Agent/Design-System
separation); `src/agentic/ui/` is the first slice proving they compose
with everything already built here, not a new architecture invented
alongside it.

- **The same three-step pipeline, minus the two steps that don't
  apply.** Step 1 (closed, compiler-provable union) is `UiKinded` +
  `UiComponentDescriptor`-shaped unions, exhaustively checked exactly
  like `Kinded` + `PatientInstruction` — see
  `tests/agentic/ui/fixtures/__typetests__/exhaustiveness.ts`, proven to
  actually fail without its `@ts-expect-error` before being trusted, the
  same way `patient/handlers/__typetests__/exhaustiveness.ts` already
  does. Step 2 (hard validation boundary between untrusted output and a
  typed object) is `toUiRenderProposal`/`validateComponent`, mirroring
  `toPlanProposal`/`validateInstruction` exactly. Step 3
  (domain-specific invariant proof) and the whole Do/Check/Act pipeline
  do not apply at all, for a reason worth stating precisely: Do exists
  to dry-run instructions against a real domain engine and inspect the
  effects; there is no engine for "render a panel," nothing to
  transition, nothing to dry-run. This is a genuine two-step pipeline
  (Plan → validate-or-fallback), not Do/Check/Act with steps quietly
  skipped.
- **`UiRenderProposal.component` is singular, not an array — a real
  divergence from `PlanProposal`, not an oversight.**
  `PlanProposal.instructions` batches because instructions are a
  *sequence of state transitions* needing all-or-nothing atomicity
  (`executeSequence`'s batch contract). A UI descriptor has no such
  causality — no "render panel A, then panel B" ordering, nothing to
  roll back — so `proposal.ts` keeps `component` singular rather than
  importing a concern this shape never had.
- **The static fallback panel is deliberately kept out of the Agent's
  own vocabulary, not made a member of `TComponent`.** Guardrail #1's
  "if validation fails, trigger a graceful fallback to a standard
  static UI" could have been modeled as a variant inside the closed
  union. It isn't: `resolveUiRenderOutcome` resolves only to `{kind:
  'render', component}` or `{kind: 'fallback', reasons}` — a typed
  decision, never a specific fallback component — and the caller
  supplies its own fixed panel for the `fallback` case, the same way
  `llmPlanner.ts`'s `CompletionFn` leaves the actual vendor call to its
  caller rather than deciding it centrally. Putting the fallback inside
  the Agent-selectable vocabulary would blur exactly the line Guardrail
  #3 draws — "what to show" (Agent) versus "what happens when the
  contract is violated" (harness) are different questions, and this
  codebase already treats that shape of separation as load-bearing
  (`ExecutionContext` staying plain data, no injected `Clock`).
- **Telemetry, not audit.** `UiProposalTelemetryEntry` is deliberately
  not `AuditRecord` reused with placeholder fields — the same "a
  different concern gets a different shape" reasoning
  `HumanActionAuditRecord`'s own doc comment already applies to the
  human-initiated path, here applied to "nothing commits state, so
  nothing needs a non-repudiable record" instead of "nothing has a
  proposal or a Check step." In-memory only, on purpose: this is a local
  debug aid, not a durable compliance store, and building durability in
  now would be solving a problem nobody has yet.
- **What this repo does not own.** `resolveUiRenderOutcome` returns a
  typed decision and never touches an actual render call — nothing
  under `src/` references `react` at all. Guardrail #3's "Design
  System's Role... 100% governed by our audited TypeScript Design
  System" names a system this repo doesn't own; the closed
  `UiComponentDescriptor` union is the shared contract both sides must
  honor, but the actual `component` → rendered-element mapping belongs
  to whichever codebase owns that Design System, not to xHIS-core.
  Building that mapping here would have been scope creep past what
  Guardrail #3 actually assigns this repo.
- **The illustrative example lives in `tests/`, not `src/`, for the
  identical reason.** This repo owns the generic contract
  (`UiKinded`, `UiRenderProposal`, `ComponentPropsValidatorRegistry`,
  ...), not any real clinical component catalog — `tests/agentic/ui/fixtures/exampleComponents.ts`
  plays the same "prove the generic mechanism in isolation, independent
  of any real domain" role `tests/core/fixtures/counterEngine.ts`
  already plays for `core/execution`, not a preview of real production
  UI.

**Follow-up: wired into the patient domain's real approval flow — and
the wiring turned out not to need the validation gate at all.**
`src/agentic/ui/patient.ts`'s `ApprovalConfirmationPanel` is the first
*real* (not illustrative) UI component this repo defines — the fixed
panel Guardrail #2 names by example ("order confirmations") for a
proposal Check has already marked `needs-human-approval`. Wired into
`tests/agentic/planning/cdssPlanningEndToEnd.test.ts`'s real "commits
once a human approves" test, immediately before
`resolveApprovalForProposal` — Dr. Lin now approves against a
deterministically-derived panel, not a bare data blob, with zero change
to `act()`, `resolveApprovalForProposal`, or anything downstream.

- **`deriveApprovalConfirmationPanel` deliberately bypasses
  `toUiRenderProposal`'s validation gate — not an oversight, a genuine
  finding about which parts of the Generative UI contract this specific
  wiring actually needs.** Every field in
  `ApprovalConfirmationPanelProps` is read from data Check has already
  validated (the proposal's own instructions, `modelVersion`,
  `promptVersion`; the decision's own `reasons`) — there is no untrusted
  Agent output being turned into UI here, so there is nothing for
  Guardrail #1's runtime validation layer to guard against. The
  validation gate exists for when an *Agent* selects which component to
  show (proven by `resolveUiRenderOutcome.test.ts`'s render/fallback
  cases); deriving the one fixed panel a `needs-human-approval` decision
  always gets is a different, simpler case the same contract module
  still had to support without forcing it through machinery it doesn't
  need.
- **Deliberately not generalized over `TInstruction` yet.**
  `deriveApprovalConfirmationPanel` is patient-specific — its
  `summarizeInstruction` switch only knows `AdmitPatient`/
  `DischargePatient` — the same "extract once a second real domain
  needs it, not before" restraint `Tick`/`IsoTimestamp` already
  followed. Generalizing now would mean guessing at a shape for a
  domain (bed, lab, ...) that hasn't asked for this wiring yet.
- **Telemetry reused as-is, not duplicated.** The same
  `UiProposalTelemetryLog` built for Agent-selected components records
  this harness-derived one too — `{component, outcome: 'rendered',
  reasons, recordedAt}` is exactly the right shape for "this panel was
  shown, and why," regardless of whether an Agent chose it or the
  harness derived it deterministically. Inventing a parallel telemetry
  type for the difference would have been a distinction without a
  consequence.

**Follow-up: the *other* half of the contract — genuinely Agent-selected
UI — proven against a real consumer too, not just the illustrative
fixture.** The wiring above deliberately bypassed
`toUiRenderProposal`'s validation gate, because nothing untrusted was
involved. `planning/cdssPlanner.ts`'s new `suggestVitalsEntryPanel`
closes the matching gap on the other side: Guardrail #2's own "vital
sign entries" example, genuinely proposed by CDSS (the same rule engine
that already proposes `AdmitPatient`), run through
`resolveUiRenderOutcome` for real in
`tests/agentic/planning/cdssPlanningEndToEnd.test.ts` — both outcomes,
not just the happy path: a well-formed suggestion renders, and the same
shape missing `patientId` falls back, exactly like an LLM's malformed
JSON would.

- **`PatientVitalsUiComponent` is deliberately a separate type from
  `PatientApprovalUiComponent`, not one union covering both.** Forcing
  them together would force a `ComponentPropsValidatorRegistry` to
  demand a validator for `ApprovalConfirmationPanel` — a component that
  structurally never reaches `toUiRenderProposal` in practice, since it
  is always harness-derived. That validator would be dead code
  standing in for a guarantee ("this can be validated as untrusted
  input") that was never actually true for that component. Same "a
  different concern gets a different shape" reasoning that already
  keeps `AuditRecord` and `HumanActionAuditRecord` separate, applied
  here to two components instead of two audit-record shapes.
- **Being deterministic still doesn't earn an exemption — proven for UI
  the same way it was already proven for instructions.**
  `cdssPlanningEndToEnd.test.ts`'s very first test in this file proved
  "CDSS is not exempt from risk-tiered human approval... regardless of
  how deterministic the source rule was" for instructions.
  `suggestVitalsEntryPanel`'s own doc comment states the identical claim
  for UI, and the new fallback test is what actually checks it: a
  deterministic rule producing an incomplete candidate gets the exact
  same fallback an LLM hallucinating a missing field would get — nothing
  about the source being a rule engine, not a model, buys it a shortcut
  around Guardrail #1's validation layer.
- **`ui/patient.ts` still doesn't know `TriageSignal` exists.**
  `suggestVitalsEntryPanel` lives in `cdssPlanner.ts`, not in
  `ui/patient.ts` — the same split `plan`'s own instruction-suggestion
  rule already draws: `ui/patient.ts` owns the patient domain's closed
  UI contract (types, validators), CDSS owns *its own* rule for what to
  suggest against that contract. Putting the suggestion rule in
  `ui/patient.ts` would have coupled the generic contract to one
  specific planner's input shape for no reason — a second planner
  proposing the same panel from different input wouldn't need to touch
  `ui/patient.ts` at all under this split.

## Resolved: bed, the second domain wired through both the verification spine and the UI contract

Both "the patient domain, Checked through the spine" and every
harness-derived UI section above ended with the same note: generalizing
past patient would need a second real domain to prove the shape
against, not guesswork. Bed is that second domain — `bedVerificationWorkers`
(`agentic/verification/bed.ts`) and `ui/bed.ts`'s `ApprovalConfirmationPanel`,
proven equivalent to `bedVerifier` and wired into a real approval flow
the same way patient's was.

- **The one thing genuinely different, found by trying to build it, not
  guessed at in advance: there is no CDSS/LLM planner for bed.** Every
  patient-domain proof above sourced its proposal from
  `createCdssTriagePlanner()`; bed has no equivalent — bed assignment
  in this codebase happens either directly through a human
  (`actHuman()`) or via choreography (`patientToBed.ts`'s reaction to a
  patient effect), never through an Agent proposing a `BedInstruction`
  sequence. `tests/agentic/verification/bed.test.ts`'s spine-equivalence
  tests and `tests/agentic/shell/bedApprovalFlowEndToEnd.test.ts` both
  use hand-constructed proposals instead — not a shortcut taken to
  avoid building a planner, but an accurate reflection of what a real
  caller actually has: `bedVerifier`'s own pre-existing tests already
  used the identical hand-built-proposal style, for the identical
  reason.
- **`BedApprovalUiComponent` tracks `bedIds`, not `encounterIds` — the
  one field choice that couldn't be copied mechanically from patient's
  panel.** `ReleaseBed` deliberately carries no `encounterId` at all
  (see `BedInstruction`'s own doc comment: the bed being released
  already has one on record, and re-asking for it would just be a
  second, possibly stale copy) — `bedId` is the one field both
  `AssignBed` and `ReleaseBed` always carry, so it's the correct
  "primary identifier" for this domain's panel, not patient's field
  name relabeled.
- **The spine-equivalence proof itself needed no new machinery** —
  `bedVerificationWorkers` is the same `verifierAsWorker` adapter over
  the same three verifiers `bedVerifier` already combines, run through
  the same `ProposalLog`/`runVerificationWorker`/`resolveVerificationState`
  pipeline patient's proof used, checked against all three of
  `bedVerifier`'s real decision shapes (accept, reject on a leaked
  national ID, needs-human-approval) rather than just the one
  needs-human-approval case every `BedInstruction` risk tier happens to
  produce today.
- **What this still doesn't do: an Agent-selected UI component for
  bed**, the counterpart to patient's `VitalsEntryPanel`. That slice
  proved the validation-gate half of the contract against a real CDSS
  suggestion; bed has no CDSS to suggest anything, so building an
  equivalent now would mean inventing a scenario this domain hasn't
  actually asked for — deferred for the identical "wait for a real
  need" reason `ui/patient.ts`'s own `VitalsEntryPanel` slice was
  deferred until CDSS existed to drive it.

## Resolved: lab, the third domain — and the first to prove the spine reaches the *correct* tier, not just *a* tier

`labVerificationWorkers` (`agentic/verification/lab.ts`) and `ui/lab.ts`'s
`ApprovalConfirmationPanel`, proven equivalent to `labVerifier` and
wired into a real approval flow the same way patient's and bed's were.
Same "no CDSS/LLM planner exists for this domain" gap bed already
documented — lab's own spine-equivalence and approval-flow tests use
hand-constructed proposals for the identical reason, not a shortcut.

- **The first domain where `needs-human-approval` isn't one uniform
  tier — real proof the spine discriminates, not just that it can reach
  *some* elevated decision.** `labRiskTiers` puts `OrderLabTest`/
  `CancelLabOrder` at `review-required` and `ReportLabResult` at its own
  higher `approval-required` — a wrong committed result can directly
  drive a wrong clinical decision downstream, the same terminal-
  consequence reasoning `DischargePatient` gets its own top tier for.
  Patient and bed each only ever produced one `needs-human-approval`
  shape in practice; lab's spine-equivalence tests check both tiers
  separately, confirming `resolveVerificationState` reaches the
  `reasons` string naming the *correct* tier in each case, not merely
  "a" `needs-human-approval`.
- **The approval-flow test proves the risk-tier → required-role lookup
  actually discriminates, using a real, multi-role policy for the first
  time.** `EXAMPLE_labApprovalPolicy` allows a `lab-technologist` *or* a
  `physician` to approve `review-required`, but only a `physician` for
  `approval-required` — patient's and bed's own approval policies never
  had this shape to exercise. Three tests prove all three real
  outcomes: a lab-technologist approves an `OrderLabTest` and it
  commits; the *same* lab-technologist attempts to approve a
  `ReportLabResult` and `resolveApproval` correctly reports it
  `unresolved` — not impersonation, a real identity simply missing the
  required role for *this* tier — and nothing commits; a physician
  approves the identical `ReportLabResult` and it does commit. Neither
  patient's nor bed's wiring had a real role distinction available to
  prove this against.
- **`LabApprovalUiComponent` tracks `orderIds`, the field every
  `LabInstruction` variant actually carries** — the same "pick the
  field every instruction kind carries, not the one a sibling domain
  happened to use" reasoning `ui/bed.ts`'s `bedIds` choice already
  established. `OrderLabTest` is the only variant with an `encounterId`
  at all; `orderId` is the one lab's three-variant instruction union
  guarantees.
- **What this still doesn't do**, for the identical reason bed's own
  section states it: an Agent-selected UI component for lab, the
  counterpart to `VitalsEntryPanel`. No CDSS exists for lab to drive
  one, so building it now would be guessing at a scenario, not proving
  one.

## Resolved: pharmacy, the fourth domain — built from scratch, not just wired

Patient, bed, and lab all pre-existed as domains before their own
verification-spine/UI-contract wiring slices; pharmacy did not exist at
all. This slice built the whole domain first — `PharmacyInstruction`
(`PrescribeMedication`/`DispenseMedication`), its handlers and engine —
then wired it through the identical spine and UI contract in the same
pass, rather than treating "build the domain" and "wire the domain" as
separate slices.

- **Deliberately just two instructions, mirroring bed's restraint, not
  lab's.** Lab grew a third instruction (`CancelLabOrder`) specifically
  because `patientToLab.ts` needed something real to react with;
  pharmacy has no analogous choreography need yet, so it stayed at the
  same minimal pair patient and bed started with. Formulary/interaction
  checking, refills, and partial dispensing are all real parts of a
  prescription's lifecycle in a real pharmacy system, and all
  deliberately out of scope for this first slice, the same restraint
  applied everywhere else in this codebase.
- **The second domain (after lab) with a genuinely two-tier risk
  shape, proving the spine discriminates again with a different pair
  of tiers.** `pharmacyRiskTiers` puts `PrescribeMedication` at
  `review-required` (correctable — a wrong prescription can still be
  caught before it's dispensed) and `DispenseMedication` at
  `approval-required` (a dispensed medication may already be
  administered — the same terminal-consequence reasoning
  `ReportLabResult` and `DischargePatient` get their own top tier for).
  `tests/agentic/verification/pharmacy.test.ts`'s spine-equivalence
  tests check both tiers separately, the same way lab's own tests do.
- **`EXAMPLE_pharmacyApprovalPolicy` inverts lab's role shape — real
  evidence that role taxonomies aren't just "physician for the risky
  tier."** Lab's top tier (`approval-required`) is `physician`-only;
  pharmacy's is `pharmacist`-only — a pharmacist, not a physician, holds
  the real-world authority and legal responsibility for verifying and
  dispensing a medication. `tests/agentic/shell/pharmacyApprovalFlowEndToEnd.test.ts`
  proves the same three-outcome shape lab's own approval-flow test
  proved, but with the roles swapped: a physician may approve
  `PrescribeMedication` (`review-required` allows either role) and it
  commits; the same physician may *not* approve `DispenseMedication`
  and nothing commits; a pharmacist approves the identical
  `DispenseMedication` and it does commit.
  `tests/agentic/pharmacy/pharmacyAgenticPipelineEndToEnd.test.ts` adds
  a third role, `nurse`, holding no privilege under this domain's
  policy at all, to prove `resolveApprovalForProposal` doesn't just
  reject the *wrong* privileged role — it rejects an unprivileged one
  too.
- **`PharmacyApprovalUiComponent` tracks `prescriptionIds`, the field
  every `PharmacyInstruction` variant actually carries** — the same
  "pick the field every instruction kind carries" reasoning `ui/bed.ts`'s
  `bedIds` and `ui/lab.ts`'s `orderIds` already established.
  `DispenseMedication` carries no `encounterId` at all (only
  `PrescribeMedication` does), but every `PharmacyInstruction` variant
  carries `prescriptionId`.
- **Same "no CDSS/LLM planner exists" gap bed and lab already
  documented, and the same "no Agent-selected UI component" gap that
  follows from it.** Pharmacy assignment/dispensing in this codebase
  happens only through a human (`actHuman()`); its spine-equivalence
  and approval-flow tests use hand-constructed proposals for the
  identical reason bed's and lab's own tests do, and building a
  `VitalsEntryPanel` counterpart now would be guessing at a scenario
  pharmacy hasn't actually asked for.

## Resolved: scheduling, the fifth domain wired through the verification spine and UI contract

Scheduling's agentic-layer integration (`schedulingRiskTiers`,
`schedulingInstructionValidators`, `schedulingVerifier`,
`EXAMPLE_schedulingApprovalPolicy`) already existed — see "Resolved:
scheduling's agentic-layer integration" above. What this slice closes
is the same last-mile gap bed, lab, and pharmacy each got their own
section for: `schedulingVerificationWorkers`
(`agentic/verification/scheduling.ts`) and `ui/scheduling.ts`'s
`ApprovalConfirmationPanel`, proven equivalent to `schedulingVerifier`
and wired into a real approval flow.

- **The first domain where the spine has to discriminate between two
  tiers with *disjoint* required roles, not a superset/subset pair.**
  Lab's and pharmacy's `approval-required` role is a strict subset of
  their `review-required` role list (`physician` alone out of
  `[physician, lab-technologist]` for lab; `pharmacist` alone out of
  `[physician, pharmacist]` for pharmacy) — a senior role always also
  covers the junior tier. `EXAMPLE_schedulingApprovalPolicy` doesn't
  work that way: `'or-director'` never appears at `review-required`
  and `'scheduling-coordinator'` never appears at `approval-required`.
  `schedulingAgenticPipelineEndToEnd.test.ts` already proved a
  scheduling-coordinator can't approve `CancelBooking`;
  `schedulingApprovalFlowEndToEnd.test.ts` adds the half that test
  couldn't show on its own — an `or-director` *succeeding* at exactly
  the tier a scheduling-coordinator fails, plus the UI panel derivation
  and telemetry recording every other domain's approval-flow test
  already exercises.
- **`SchedulingApprovalUiComponent` tracks `bookingIds`, the field
  every `SchedulingInstruction` variant actually carries** — the same
  "pick the field every instruction kind carries" reasoning `ui/bed.ts`'s
  `bedIds`, `ui/lab.ts`'s `orderIds`, and `ui/pharmacy.ts`'s
  `prescriptionIds` already established. `resourceId`/`subjectId`/
  `startAt`/`endAt` only exist on `ScheduleBooking`; `bookingId` is the
  one field both variants carry.
- **Scheduling already has a real choreography consumer
  (`patientToScheduling.ts`), unlike bed/lab/pharmacy at the time their
  own sections were written — but that doesn't change the "no CDSS/LLM
  planner" gap.** `patientToScheduling.ts`'s reaction commits directly
  through `actHuman()`, never through this spine's
  `ProposalLog`/`toPlanProposal` path, so
  `schedulingVerificationWorkers`' own spine-equivalence tests still use
  hand-constructed proposals for the identical reason bed's, lab's, and
  pharmacy's do — a real consumer existing elsewhere in the codebase
  doesn't retroactively make it a consumer of *this* pipeline.
- **What this still doesn't do**, for the identical reason every prior
  domain's own section states it: an Agent-selected UI component for
  scheduling, the counterpart to `VitalsEntryPanel`. No CDSS exists for
  scheduling to drive one, so building it now would be guessing at a
  scenario, not proving one.

## Resolved: ledger, the sixth domain wired through the verification spine and UI contract

Ledger's agentic-layer integration (`ledgerRiskTiers`,
`ledgerInstructionValidators`, `ledgerVerifier`,
`EXAMPLE_ledgerApprovalPolicy`) already existed. This slice closes the
same last-mile gap bed, lab, pharmacy, and scheduling each got their
own section for: `ledgerVerificationWorkers`
(`agentic/verification/ledger.ts`) and `ui/ledger.ts`'s
`ApprovalConfirmationPanel`, proven equivalent to `ledgerVerifier` and
wired into a real approval flow.

- **Back to the superset/subset role shape after scheduling's disjoint
  one, and a genuine reason to check rather than assume it still
  holds.** `EXAMPLE_ledgerApprovalPolicy`'s `'approval-required':
  ['finance-controller']` is a strict subset of `'review-required':
  ['billing-clerk', 'finance-controller']` — the same shape lab's and
  pharmacy's policies have, unlike scheduling's disjoint
  `'or-director'`/`'scheduling-coordinator'` split. The spine-equivalence
  tests in `tests/agentic/verification/ledger.test.ts` still had to be
  written and run, not assumed to pass by analogy to lab's — the point
  scheduling's own section already made about not assuming a hierarchy
  cuts both ways: the spine also can't be assumed to *keep* working
  correctly once tiers go back to overlapping, only proven to.
- **`ledgerAgenticPipelineEndToEnd.test.ts` already proved a
  billing-clerk cannot approve `ReverseEntry`; `ledgerApprovalFlowEndToEnd.test.ts`
  adds the half that test couldn't show on its own** — a
  `finance-controller` actually *succeeding* at exactly the tier a
  billing-clerk fails, plus the UI panel derivation and telemetry
  recording every other domain's own approval-flow test already
  exercises. Same split `schedulingApprovalFlowEndToEnd.test.ts`'s own
  section documents for scheduling: the pipeline test proves *rejection*
  correctly happens; the approval-flow test proves the *other* role's
  *success* on the identical instruction, which the pipeline test's
  own scope never needed to cover.
- **`LedgerApprovalUiComponent` tracks `entryIds`, the field every
  `LedgerInstruction` variant actually carries** — the same "pick the
  field every instruction kind carries" reasoning `ui/bed.ts`'s
  `bedIds`, `ui/lab.ts`'s `orderIds`, `ui/pharmacy.ts`'s
  `prescriptionIds`, and `ui/scheduling.ts`'s `bookingIds` already
  established. `lines`/`memo`/`postedAt` only exist on `PostEntry`;
  `entryId` is the one field both variants carry.
- **What this still doesn't do**, for the identical reason every prior
  domain's own section states it: an Agent-selected UI component for
  ledger, the counterpart to `VitalsEntryPanel`. No CDSS exists for
  ledger to drive one, so building it now would be guessing at a
  scenario, not proving one.

## Resolved: imaging, the seventh domain wired through the verification spine and UI contract

Imaging's agentic-layer integration (`imagingRiskTiers`,
`imagingInstructionValidators`, `imagingVerifier`,
`EXAMPLE_imagingApprovalPolicy`) already existed. This slice closes the
same last-mile gap bed, lab, pharmacy, scheduling, and ledger each got
their own section for: `imagingVerificationWorkers`
(`agentic/verification/imaging.ts`) and `ui/imaging.ts`'s
`ApprovalConfirmationPanel`, proven equivalent to `imagingVerifier` and
wired into a real approval flow.

- **Four instruction kinds collapsing to a tier shape the spine had
  already proven, not a new one.** `imagingRiskTiers` puts `OrderStudy`,
  `RecordStudyStored`, and `CancelStudy` all at `review-required`, and
  only `ReportStudy` at `approval-required` — still just two tiers in
  practice, the same shape lab's and pharmacy's spines already
  discriminate correctly. What's actually new is
  `EXAMPLE_imagingApprovalPolicy`'s roles, not the tier count: its top
  tier (`'radiologist'`) doesn't appear at all in its lower tier's role
  list (`['physician', 'radiologic-technologist']`) — string-level
  disjoint, the same shape scheduling's spine had to prove reachable,
  even though conceptually a radiologist *is* a kind of physician. The
  spine doesn't reason about role semantics, only literal role-string
  membership per tier, so this is still a fresh proof, not a repeat of
  lab's subset shape or scheduling's disjoint one by assumption.
- **`imagingAgenticPipelineEndToEnd.test.ts` already proved a referring
  physician cannot approve `ReportStudy`; `imagingApprovalFlowEndToEnd.test.ts`
  adds the half that test couldn't show on its own** — a `radiologist`
  actually *succeeding* at exactly the tier a physician fails, plus the
  UI panel derivation and telemetry recording every other domain's own
  approval-flow test already exercises. Same split ledger's and
  scheduling's own sections document: the pipeline test proves
  *rejection*; the approval-flow test proves the *other* role's
  *success* on the identical instruction.
- **`ImagingApprovalUiComponent` tracks `studyIds`, the field every
  `ImagingInstruction` variant actually carries** — the same "pick the
  field every instruction kind carries" reasoning `ui/bed.ts`'s
  `bedIds`, `ui/lab.ts`'s `orderIds`, `ui/pharmacy.ts`'s
  `prescriptionIds`, `ui/scheduling.ts`'s `bookingIds`, and
  `ui/ledger.ts`'s `entryIds` already established. `encounterId`/
  `modality` only exist on `OrderStudy`, `storageRef` only on
  `RecordStudyStored`; `studyId` is the one field all four variants
  carry.
- **What this still doesn't do**, for the identical reason every prior
  domain's own section states it: an Agent-selected UI component for
  imaging, the counterpart to `VitalsEntryPanel`. No CDSS exists for
  imaging to drive one, so building it now would be guessing at a
  scenario, not proving one.

## Resolved: nursing, the eighth and last domain wired through the verification spine and UI contract

Nursing's agentic-layer integration (`nursingRiskTiers`,
`nursingInstructionValidators`, `nursingVerifier`,
`EXAMPLE_nursingApprovalPolicy`) already existed. This slice closes the
same last-mile gap every other domain got its own section for:
`nursingVerificationWorkers` (`agentic/verification/nursing.ts`) and
`ui/nursing.ts`'s `ApprovalConfirmationPanel`, proven equivalent to
`nursingVerifier` and wired into a real approval flow. **This is the
last domain** — every domain in this codebase (patient, bed, lab,
pharmacy, scheduling, ledger, imaging, nursing) is now routed through
both the verification spine and the Generative UI contract.

- **`GrantRole`'s `'approval-required'` tier is the highest-stakes top
  tier of any domain, and the spine had to reach it correctly anyway.**
  `risk/nursing.ts`'s own doc comment already establishes why: nursing's
  own committed state is what a real `IdentityProvider` derives every
  *other* domain's approval authority from, so a wrongful `GrantRole`
  isn't scoped to nursing — it's systemic. `nursingVerificationWorkers`'
  spine-equivalence tests prove the spine discriminates this tier from
  `IssueCredential`/`RevokeCredential`'s `review-required` correctly,
  the same proof obligation every prior domain's top tier already
  passed, just with the largest blast radius if it had failed silently.
- **`NursingApprovalUiComponent` tracks `credentialIds` — but this is
  the first domain where that field isn't uniformly a record's own
  identifier.** `IssueCredential`/`RevokeCredential` carry `credentialId`
  as their own primary key, matching every prior domain's panel field
  choice (`bedIds`, `orderIds`, `prescriptionIds`, `bookingIds`,
  `entryIds`, `studyIds`); `GrantRole`'s own identifier is `grantId` —
  it carries `credentialId` only as a foreign key to the credential
  backing the grant. The panel still uses it, because the actual
  criterion has always been "the field every instruction kind carries,"
  not "the subject's own primary key" specifically — this domain is
  just the first where those two descriptions diverge.
- **`nursingApprovalFlowEndToEnd.test.ts` deliberately uses the same
  plain `createInMemoryIdentityProvider` every other domain's
  approval-flow test uses, not `createNursingIdentityProvider`.**
  `nursingAgenticPipelineEndToEnd.test.ts`'s own `GrantRole` test already
  proved something no other domain could — that a `GrantRole` approval
  can be resolved against nursing's *own* committed state rather than a
  hand-maintained list, closing the loop `nursingIdentityProvider.ts`'s
  doc comment describes. This file's job is different: proving the
  ordinary approval-flow shape (UI panel derivation, telemetry, a role
  succeeding where another fails) that every other domain's own
  approval-flow test already established, so it deliberately uses the
  same simple mechanism they do rather than re-deriving the more
  sophisticated proof the pipeline test already owns.
- **What this still doesn't do**, for the identical reason every prior
  domain's own section states it: an Agent-selected UI component for
  nursing, the counterpart to `VitalsEntryPanel`. No CDSS exists for
  nursing to drive one, so building it now would be guessing at a
  scenario, not proving one. Unlike every prior domain's section, this
  gap is now uniform across all eight domains — only `patient` has one,
  because only `patient` has a CDSS to drive it.

## Resolved: CDSS as a Plan source for a second domain (bed)

"Resolved: CDSS as a Plan source" above proved the pattern once, for
patient's `createCdssTriagePlanner`. `createCdssBedPlanner`
(`agentic/planning/cdssBedPlanner.ts`) is the second real domain to get
one — implementing the identical untrusted `RawPlanner<TCtx>` contract,
with zero pipeline code changed, proven through the same three-layer
test structure patient's own CDSS slice used
(`cdssBedPlanner.test.ts`'s unit tests, `cdssBedPlanningEndToEnd.test.ts`'s
Do/Check/Approve/Act proof, `cdssBedPlanningThroughVerificationSpineEndToEnd.test.ts`'s
spine proof).

- **Bed already has an existing, unrelated automatic path for the exact
  same real-world event — building this anyway is not redundancy, it's
  the point.** `patientToBed.ts`'s `EncounterAdmitted` choreography
  already assigns a bed the moment a patient is admitted, immediately
  and with no Check/Approve gate at all. `createCdssBedPlanner` produces
  the identical `AssignBed` instruction shape from a structurally
  similar signal, but routes it through the full Agent-Checked,
  human-approved pipeline instead. Nothing about Plan/Check/Approve/Act
  existing for a domain forces every real caller through it — `actHuman()`
  and choreography already proved that by coexisting for bed before
  this planner existed; this is a third coexisting path for the same
  domain, not a replacement for either of the first two.
- **The one genuinely new wrinkle patient's triage planner never had to
  handle: a shared, exhaustible resource across signals in the same
  proposal.** Patient's admission target space never runs out — every
  `emergent` signal can independently get its own `AdmitPatient`
  recommendation. Bed availability can: two signals in the same
  proposal both wanting a bed, with only one actually available, is a
  real scenario, not a theoretical one, and processing signals against
  an unthreaded snapshot of `BedContext` would let both be recommended
  the *same* `bedId` — a double-booking bug `bedEngine.executeSequence`
  would only catch later, as a `BedAlreadyOccupied` failure on the
  second instruction, after the planner had already claimed success on
  both. `createCdssBedPlanner` instead threads a local, hypothetical
  `BedContext` forward across signals — updated after each accepted
  recommendation, never touching the real `context.bedContext` the
  caller passed in, and never itself committing anything.
  `cdssBedPlanner.test.ts`'s "never recommends the same bed to two
  different signals in the same proposal" test is the direct proof.
- **Reuses `BedSelectionStrategy` and `findBedHoldingEncounter` rather
  than reimplementing either.** Both already existed for
  `patientToBed.ts`'s choreography reaction; this planner takes the
  identical selection policy as an explicit input (the same reason
  `reactToPatientEffect` takes one as a parameter rather than importing
  `EXAMPLE_firstAvailableBedStrategy` directly) and the identical
  data-integrity-aware lookup, rather than growing a second, possibly
  divergent implementation of either.
- **What this deliberately doesn't do: an Agent-selected UI component
  for bed** (`suggestVitalsEntryPanel`'s counterpart). Patient's own
  `VitalsEntryPanel` suggestion rule was itself a separate, later slice
  built only once a real CDSS existed to drive it — not bundled with
  `createCdssTriagePlanner` itself. This slice follows the identical
  ordering: the planner is what was asked for and proven here; a UI
  suggestion built now, unasked and with no concrete render target
  decided, would be guessing at a scenario rather than proving one.

## Resolved: CDSS as a Plan source for a third domain (lab)

`createCdssLabPlanner` (`agentic/planning/cdssLabPlanner.ts`) is the
third real domain to get a CDSS rule implementing the untrusted
`RawPlanner<TCtx>` contract, after patient's `createCdssTriagePlanner`
and bed's `createCdssBedPlanner` — proven through the identical
three-layer test structure both of those got. Like bed's, it's a third
path to an instruction shape (`CancelLabOrder`) `patientToLab.ts`'s own
choreography can already produce immediately with no Check/Approve
gate — see `createCdssBedPlanner`'s own doc comment for why that's not
redundant, unchanged here.

- **The two real differences from `createCdssBedPlanner` were both
  already predicted by `patientToLab.ts`'s own doc comment, written
  before this planner existed, contrasting lab's choreography with
  bed's.** That file states plainly: bed's reaction "picks *one* bed via
  a `BedSelectionStrategy`, but lab has no equivalent selection policy at
  all." This planner inherits exactly that contrast one layer up: it
  needs no cross-signal resource-contention handling at all (no
  hypothetical-context-threading the way `createCdssBedPlanner` needs,
  because cancelling one encounter's pending orders never contends with
  another's), and one signal can map to *zero, one, or many*
  `CancelLabOrder` instructions — the same "zero, one, or many, no
  'which one' decision" shape `patientToLab.ts`'s own `PatientLabReaction`
  already has for the identical real-world trigger.
  `cdssLabPlanner.test.ts`'s "recommends cancellation of every pending
  order for a single discharge signal" test is the many-to-one proof;
  its "handles multiple independent discharge signals without any
  cross-signal interaction" test is the no-contention proof, phrased as
  the direct contrast to `createCdssBedPlanner`'s own
  no-double-booking test.
- **No signal field ever taints the output instruction here, unlike
  bed's — a real, not cosmetic, difference in what "broken input" even
  means for this rule.** `AssignBed` copies `signal.encounterId`
  straight into the output instruction, so a malformed signal directly
  produces an invalid one; `CancelLabOrder` carries no `encounterId` at
  all (see `LabInstruction`'s own shape), so the discharge signal's
  `encounterId` is consumed only by the lookup and never appears in what
  gets proposed. `cdssLabPlanningEndToEnd.test.ts`'s own
  retry-determinism test had to find a different unchanging bad input to
  prove the same "a deterministic rule can't recover via feedback"
  claim `createCdssTriagePlanner`'s and `createCdssBedPlanner`'s own
  tests already proved with a malformed signal — here it's a malformed
  `proposedAt`, the one value the rule's output does carry through
  unvalidated on every attempt.
- **Rejecting a triage-shaped signal for lab ("this admission implies
  these orders") was a deliberate design choice, not an oversight.**
  `cdssLabPlanner.ts`'s own doc comment states why: that shape would
  require inventing which test to order, exactly the clinical judgment
  `patientToLab.ts`'s own choreography already refuses to have an
  opinion about (`EncounterAdmitted` triggers no lab reaction there
  either). A discharge-shaped signal needs no such invention —
  cancellation is a pure lookup, not a clinical decision.
- **What this still doesn't do**, for the identical reason bed's own
  section states it: an Agent-selected UI component for lab. No
  concrete render target has been decided for lab, so building one now
  would be guessing at a scenario, not proving one.

## Resolved: CDSS as a Plan source for a fourth domain (pharmacy)

`createCdssPharmacyPlanner` (`agentic/planning/cdssPharmacyPlanner.ts`)
is the fourth real domain to get a CDSS rule implementing the untrusted
`RawPlanner<TCtx>` contract, after patient's `createCdssTriagePlanner`,
bed's `createCdssBedPlanner`, and lab's `createCdssLabPlanner` — proven
through the identical three-layer test structure all three of those
got.

- **Unlike bed and lab, pharmacy has no existing choreography reaction
  at all.** There is no `patientToPharmacy.ts` the way there's a
  `patientToBed.ts`/`patientToLab.ts` — pharmacy was built from scratch
  in this codebase with no discharge- or admission-triggered automation
  ever wired to it. So this planner is pharmacy's *first* automated path
  to any instruction, not a third one coexisting alongside an immediate,
  unapproved reaction the way `createCdssBedPlanner`'s and
  `createCdssLabPlanner`'s own doc comments describe for theirs.
- **The genuinely new proof this planner adds: CDSS is not exempt from
  risk-tiered approval even at the *highest*-stakes tier, not just the
  lower one every prior CDSS recommendation happened to land on.**
  `AdmitPatient`, `AssignBed`, and `CancelLabOrder` are all
  `'review-required'`; `DispenseMedication` is pharmacy's own top tier,
  `'approval-required'`, `pharmacist`-only. Until this planner, the
  "CDSS is not exempt from risk-tiered human approval... regardless of
  how deterministic the source rule was" claim this document makes had
  only ever been checked against the lower tier.
  `cdssPharmacyPlanningEndToEnd.test.ts`'s main test proves the harder
  case directly: a physician — permitted at pharmacy's own
  `review-required` tier — still cannot approve a CDSS-recommended
  dispense; only a pharmacist can.
- **A `prescriptionId` signaled twice in one batch is recommended at
  most once, for a different reason than `createCdssBedPlanner`'s
  duplicate-bed guard.** Bed's planner threads state forward because bed
  availability is a *shared, contended* resource across signals;
  pharmacy's has no such resource at all — the actual risk here is that
  two `DispenseMedication` instructions for the identical
  `prescriptionId` in one proposal would doom the *whole* batch at Do
  time (`executeSequence`'s all-or-nothing contract means the second
  instruction finding the first one's effect already applied and
  failing would reject even the valid first one). Two structurally
  different problems, arrived at from two different domains' own
  instruction semantics, both requiring the same shape of fix — not
  evidence the fix generalizes automatically, evidence it has to be
  re-derived and re-checked for each domain's own reason.
- **Signal design deliberately mirrors the target, not the trigger.**
  Bed's and lab's signals both name an *encounter*, because their rules
  each still have work to do (select a bed; look up pending orders).
  Pharmacy's signal names the *prescription* directly — there is nothing
  left to select or look up once dispensing is what's being
  recommended, so naming anything but the specific target
  (`prescriptionId`) would just be indirection with no purpose.
- **What this still doesn't do**, for the identical reason every prior
  CDSS planner's own section states it: an Agent-selected UI component
  for pharmacy. No concrete render target has been decided, so building
  one now would be guessing at a scenario, not proving one.

## Resolved: CDSS as a Plan source for a fifth domain (scheduling)

`createCdssSchedulingPlanner` (`agentic/planning/cdssSchedulingPlanner.ts`)
is the fifth real domain to get a CDSS rule implementing the untrusted
`RawPlanner<TCtx>` contract, after patient, bed, lab, and pharmacy.

- **The rule itself is deliberately close to `createCdssLabPlanner`'s —
  and that closeness is the point, not a shortcut being papered over.**
  `patientToScheduling.ts`'s own doc comment already states that the
  "booking never implied by admission, discharge cancels every pending
  one" reasoning "recurs a third time" after lab and imaging, because
  booking creation genuinely shares lab's own "never implied by
  admission" trait. Reusing the identical rule shape (many-to-one,
  lookup-driven, no cross-signal contention) is the correct response to
  a genuinely repeated domain situation, not evidence this slice skipped
  real design work.
- **What still had to be checked fresh, not assumed by analogy: the
  risk tier lands at the *top*, unlike lab's.** `CancelBooking` is
  `'approval-required'` — scheduling's own top tier, because a cancelled
  `bookingId` can never be scheduled again (no undo at all, the same
  terminal-consequence shape pharmacy's `DispenseMedication` earns its
  own top tier for) — while lab's `CancelLabOrder` recommendation landed
  at the lower `'review-required'`. This is only the *second* CDSS
  recommendation in this codebase to land at a top tier, and the first
  to do so for a *disjoint*, not nested, approval policy (see next
  point) — a combination neither `createCdssPharmacyPlanner`'s proof nor
  the original scheduling-domain wiring (PR #22) had exercised together
  before.
- **Scheduling's disjoint approval policy required a genuinely different
  failure mode than pharmacy's nested one.** `cdssSchedulingPlanningEndToEnd.test.ts`
  proves a `scheduling-coordinator` cannot approve a CDSS-recommended
  `CancelBooking` — but not because they sit one tier too low inside a
  shared hierarchy the way pharmacy's `physician` does at
  `DispenseMedication`. `EXAMPLE_schedulingApprovalPolicy`'s two tiers
  share no role at all; a `scheduling-coordinator` and an `or-director`
  are unrelated roles, not a junior/senior pair. Only the `or-director`
  clears it.
- **`findPendingBookingsForEncounter` matches by convention
  (`subjectId === encounterId`), not a real foreign key** — reused
  unchanged from `patientToScheduling.ts`'s own choreography. A booking
  for equipment maintenance or a staff shift never matches any
  encounter at all, correctly; `cdssSchedulingPlanner.test.ts`'s own
  test proves this rule never recommends cancelling one just because its
  `subjectId` happens to look plausible.
- **What this still doesn't do**, for the identical reason every prior
  CDSS planner's own section states it: an Agent-selected UI component
  for scheduling. No concrete render target has been decided, so
  building one now would be guessing at a scenario, not proving one.

## Resolved: CDSS as a Plan source for a sixth domain (ledger)

`createCdssLedgerPlanner` (`agentic/planning/cdssLedgerPlanner.ts`) is
the sixth real domain to get a CDSS rule implementing the untrusted
`RawPlanner<TCtx>` contract, after patient, bed, lab, pharmacy, and
scheduling.

- **Ledger has no existing choreography reaction, like pharmacy, unlike
  bed/lab/scheduling.** There is no `patientToLedger.ts` — ledger's
  entries are posted and reversed purely through explicit instructions,
  never implied by any patient effect. So this is ledger's first
  automated path to any instruction, the same "not a third path
  alongside an existing one" situation `createCdssPharmacyPlanner`'s own
  doc comment describes for pharmacy, not bed's/lab's/scheduling's
  "coexists with an immediate, unapproved reaction" situation.
- **The rule shape is `createCdssPharmacyPlanner`'s, reused deliberately
  for the same underlying reason.** `ReverseEntry`, like
  `DispenseMedication`, names its own target directly (`entryId`) with
  nothing left to select or look up, and — the same restraint
  `cdssPharmacyPlanner.ts`'s own doc comment states for
  `PrescribeMedication` — recommending `PostEntry` would require
  inventing real financial content (which accounts, which amounts) this
  codebase has no authority over. The duplicate-target dedup guard
  (an `entryId` signaled twice in one batch is recommended at most once)
  is reused for the identical reason too: two `ReverseEntry` instructions
  for the same entry would doom the whole batch at Do time, not a
  resource-contention concern the way bed's duplicate-bed guard is.
- **The third CDSS recommendation to land at a top tier, and the first
  to combine that with a *nested*, not disjoint, approval policy.**
  `ReverseEntry` is `'approval-required'`; `EXAMPLE_ledgerApprovalPolicy`'s
  `'approval-required': ['finance-controller']` is a strict subset of
  `'review-required': ['billing-clerk', 'finance-controller']` — the
  same nested shape pharmacy's policy has, not scheduling's disjoint
  one. `cdssLedgerPlanningEndToEnd.test.ts` proves a `billing-clerk`
  fails for the "one tier too low inside a shared hierarchy" reason a
  physician fails to approve pharmacy's `DispenseMedication`, not
  scheduling's "unrelated role entirely" reason — the same distinction
  the original ledger-domain wiring (PR #23) already drew, now
  reconfirmed for a CDSS-sourced proposal specifically rather than
  assumed to still hold.
- **What this still doesn't do**, for the identical reason every prior
  CDSS planner's own section states it: an Agent-selected UI component
  for ledger. No concrete render target has been decided, so building
  one now would be guessing at a scenario, not proving one.

## Resolved: CDSS as a Plan source for a seventh domain (imaging)

`createCdssImagingPlanner` (`agentic/planning/cdssImagingPlanner.ts`) is
the seventh real domain to get a CDSS rule implementing the untrusted
`RawPlanner<TCtx>` contract, after patient, bed, lab, pharmacy,
scheduling, and ledger.

- **The honest finding here is that nothing new needed proving about
  the spine or the approval mechanism — every dimension that mattered
  for lab's own proof checks out identically for imaging.**
  `findPendingStudiesForEncounter` matches on a real, branded
  `EncounterId` foreign key, the same as lab's, not scheduling's
  convention-only `subjectId` (`imagingLookup.ts`'s own doc comment
  says it "mirrors ... `findPendingLabOrdersForEncounter` exactly").
  `CancelStudy` is `'review-required'`, the same lower tier lab's
  `CancelLabOrder` recommendation lands at, not scheduling's or ledger's
  top `'approval-required'`. `EXAMPLE_imagingApprovalPolicy`'s
  `'review-required'` list has two valid approvers, the same shape
  lab's own lower tier has. Three domains (lab, scheduling, imaging) now
  share the identical "discharge cancels every still-pending target"
  real-world shape; this is the second of the three (after lab) to land
  on that exact tier/policy combination, purely because
  `risk/imaging.ts`'s and `identity/imaging.ts`'s own,
  independently-authored choices happened to land there — not because
  it was assumed to transfer without checking.
- **What still had genuine value despite the unsurprising rule shape:
  proving *imaging's own* validators, engine, verifier, and UI panel
  are wired together correctly for a CDSS-sourced `CancelStudy`.** A
  generic rule shape being unsurprising doesn't make the domain-specific
  wiring check itself skippable — `cdssImagingPlanningEndToEnd.test.ts`
  and its spine counterpart exercise imaging's real
  `imagingInstructionValidators`, `imagingEngine`, `imagingVerifier`,
  and `ui/imaging.ts`'s panel exactly as they exist today, not a
  stand-in.
- **No approving-role contrast to draw, unlike every prior CDSS
  end-to-end file.** Lab's, pharmacy's, scheduling's, and ledger's own
  end-to-end tests each proved one role fails and a different one
  succeeds at some tier. `CancelStudy`'s tier has two valid approvers
  and this rule only ever recommends that one instruction kind, so there
  is no CDSS-recommended instruction here for which any of imaging's
  own roles would fail — the interesting claim left to prove is only
  that *some* permitted approval is still required, never an outright
  `accept`, the identical claim lab's own `OrderLabTest` test proves at
  its identical tier.
- **What this still doesn't do**, for the identical reason every prior
  CDSS planner's own section states it: an Agent-selected UI component
  for imaging. No concrete render target has been decided, so building
  one now would be guessing at a scenario, not proving one.

## Resolved: CDSS as a Plan source for the eighth and last domain (nursing)

`createCdssNursingPlanner` (`agentic/planning/cdssNursingPlanner.ts`)
is the eighth, and last, domain to get a CDSS rule implementing the
untrusted `RawPlanner<TCtx>` contract. **Every domain in this codebase**
(patient, bed, lab, pharmacy, scheduling, ledger, imaging, nursing) now
has one, closing the same coverage gap the verification-spine and
UI-contract wiring already closed earlier this session.

- **Nursing has no choreography at all — not even the "first automated
  path" situation pharmacy's and ledger's own sections describe.**
  Pharmacy and ledger at least lacked a *choreography* reaction while
  still being triggered by a real-world clinical event a signal could
  plausibly represent (a pharmacy queue, a reconciliation flag).
  Nursing's credentialing has no patient-effect trigger of any kind to
  begin with — no encounter admission or discharge ever implies
  anything about a staff member's credentials. The restraint not to
  invent a triage-shaped signal here isn't borrowed from a sibling
  domain's precedent; it's domain-first, because there is no sibling
  precedent that applies.
- **`RevokeCredential` reuses the named-target, dedup-guarded rule
  shape `createCdssPharmacyPlanner`'s and `createCdssLedgerPlanner`'s
  own sections established, but lands at the *lower* tier those two
  didn't — the first time this shape and a top tier have been
  decoupled.** `RevokeCredential` is `'review-required'`, the same
  lower tier `CancelLabOrder`'s and `CancelStudy`'s CDSS
  recommendations land at, not `DispenseMedication`'s/`ReverseEntry`'s
  `'approval-required'` — even though this rule shares their exact
  single-target shape, not lab's/imaging's many-to-one one.
  `risk/nursing.ts`'s own doc comment gives the reason: a role grant
  already made stays valid even if its backing credential is later
  revoked, so a wrongful revoke is an operational nuisance, not a
  wrong-value-drives-a-wrong-decision shape — proving the rule *shape*
  (named target, dedup guard) and the risk *tier* it lands at are
  genuinely independent choices, not a package deal the way every prior
  domain's own combination might have suggested.
- **`GrantRole` was ruled out for a stronger reason than "would invent
  content" — it is the one instruction whose committed state backs
  every other domain's own approval authority.** `cdssNursingPlanner.ts`'s
  own doc comment states this plainly: recommending a role grant from a
  rule this simple would let an unreviewed CDSS heuristic originate the
  exact permission grant this entire spine exists to gate carefully.
  Every prior domain's "don't invent the primary action" CDSS
  restraint (`OrderLabTest`'s test code, `PrescribeMedication`'s
  medication, `PostEntry`'s accounts) was about missing clinical
  content; this one is about blast radius specifically, the same
  distinction `risk/nursing.ts`'s own doc comment already draws for why
  `GrantRole` earns the single highest-stakes tier of any instruction
  in this codebase.
- **What this still doesn't do**, for the identical reason every prior
  CDSS planner's own section states it: an Agent-selected UI component
  for nursing. Unlike every prior domain's own section, this gap is now
  uniform across all eight domains — only `patient` has one, because
  only `patient` has a CDSS to drive it, the same observation "Resolved:
  nursing, the eighth and last domain wired through the verification
  spine and UI contract" already made for the spine/UI-contract half of
  this coverage sweep.

## Resolved: the Agent-selected UI half of the contract, proven against a second domain (bed)

Every CDSS-planner section above closed with the identical line: no
Agent-selected UI component exists for that domain, because only
`patient` has one to drive. `cdssBedPlanner.ts`'s new
`suggestVitalsEntryPanel` closes that gap for bed specifically — not by
inventing a bed-specific component, but by giving bed's own CDSS rule
(`createCdssBedPlanner`) the ability to propose the *identical*
`VitalsEntryPanel` patient's triage rule already proposes.

- **`VitalsEntryPanel` is reused, not duplicated — the concept belongs
  to the UI action, not to whichever domain's rule happened to trigger
  it.** A vitals-entry form needs to know which patient's vitals it's
  collecting regardless of *why* someone decided vitals should be
  entered; triage noticing that reason (a new admission) and bed
  noticing it (a new bed assignment) are two independent, real
  motivations for the identical suggestion. Reusing
  `PatientVitalsUiComponent`/`patientVitalsComponentPropsValidators`
  from `ui/patient.ts` rather than defining a same-shaped
  `BedVitalsUiComponent` is the same "the concept belongs to the domain
  that actually owns it" reasoning `instructions/bed/ids.ts` already
  applies to re-exporting `EncounterId` from patient instead of
  rebranding a second, incompatible one.
- **`BedNeedSignal` needed a real, motivated extension —
  `patientId` — not an invented one.** The rule `createCdssBedPlanner`
  already runs never reads `patientId`; only `suggestVitalsEntryPanel`
  does. But a genuine "this encounter needs a bed" signal was always
  going to know which patient it's for — the same "a signal already
  knows this in reality" reasoning `TriageSignal` was built with from
  its first slice — so this wasn't retrofitting a field to satisfy a
  type, it was noticing bed's own signal had been narrower than the
  real event it represents.
- **Reused the validation gate proof, not just the component.**
  `cdssBedPlanningEndToEnd.test.ts`'s two new tests are structurally
  identical to `cdssPlanningEndToEnd.test.ts`'s own vitals tests — a
  well-formed suggestion renders, and the identical shape with
  `patientId` corrupted away falls back — because the claim being
  proven ("Agent-selected content, however deterministic its source,
  still passes through Guardrail #1's validation layer") doesn't change
  per domain; only the caller proposing the component does.
- **What this still doesn't do: an Agent-selected UI component for
  pharmacy, scheduling, ledger, imaging, or nursing.** Bed earned this
  slice specifically because `VitalsEntryPanel` was already a natural
  fit for "a new bed assignment" the same way it was for "a new
  admission." Whether any *other* domain's own CDSS signal has an
  equally natural UI-suggestion counterpart is a separate question this
  slice doesn't answer — building one for a domain without first
  finding that natural fit would be guessing at a scenario, the same
  restraint this whole coverage sweep has applied throughout. **Lab has
  since found one too — see the next section.**

## Resolved: the Agent-selected UI half of the contract, proven against a third domain (lab)

`cdssLabPlanner.ts`'s new `suggestVitalsEntryPanel` gives lab's own
CDSS rule the same `VitalsEntryPanel`-suggestion ability bed's own
section just proved for bed — the third real caller of the identical
component, after patient's admission-triggered one and bed's
assignment-triggered one.

- **The real-world motivation here is genuinely different from
  patient's and bed's, not a mechanical third repeat.** Patient's and
  bed's own triggers are both *arrival* checkpoints — a new admission,
  a new bed assignment — where a baseline vitals reading is the obvious
  first clinical action. Lab's trigger is a *discharge*, the opposite
  direction. The justification isn't "reuse the component because it
  worked twice before" — it's "discharge vitals," a real, independently
  motivated clinical safety practice (a final set of vitals confirming
  a patient is stable before release), unrelated to why patient's or
  bed's own triggers happened to fit. The component and the validation
  gate it passes through don't care which direction motivated the
  suggestion; only the caller's real-world reasoning does, and that
  reasoning had to be found fresh for lab, not inherited from bed's.
- **`LabDischargeSignal` gained `patientId` for the identical reason
  `BedNeedSignal` did.** The cancellation rule itself never reads it —
  a discharge is resolved purely by `encounterId` — only
  `suggestVitalsEntryPanel` does. A genuine discharge signal was always
  going to know which patient it's for, the same "the signal was
  narrower than the real event it represents" finding bed's own section
  already made.
- **Reused the exact validation-gate proof a third time, not just the
  component.** `cdssLabPlanningEndToEnd.test.ts`'s two new tests are
  structurally identical to patient's and bed's own vitals tests — a
  well-formed suggestion renders, and the identical shape with
  `patientId` corrupted away falls back — because the claim being
  proven doesn't change per domain or per caller.
- **What this still doesn't do: an Agent-selected UI component for
  pharmacy, scheduling, ledger, imaging, or nursing.** Two domains in a
  row (bed, lab) finding a real fit for the identical component is
  still not evidence every remaining domain will — pharmacy's dispense
  event, scheduling's cancellation, ledger's reversal, imaging's
  cancellation, and nursing's revocation are each a different kind of
  real-world event, and whether any of them has an equally genuine
  UI-suggestion counterpart (to `VitalsEntryPanel` or to something else
  entirely) remains an open question this slice doesn't answer.
  **Pharmacy has since been checked, and deliberately declined — see
  the next section.**

## Resolved: why pharmacy doesn't get the VitalsEntryPanel-style UI suggestion

Checked, and deliberately not built. Patient's admission, bed's
assignment, and lab's discharge each share a property that made
reusing `VitalsEntryPanel` honest rather than a stretch: every single
instance of that event genuinely benefits from a vitals check, with no
per-case judgment required. `createCdssPharmacyPlanner`'s own
`PharmacyDispenseReadySignal` doesn't share that property, and building
the suggestion anyway would have meant fabricating a distinction this
codebase has no data to draw.

- **Dispensing a medication isn't universally vitals-relevant the way
  the first three triggers were.** Real clinical practice only
  pre-checks vitals before dispensing *certain* medications — BP
  medications, insulin, cardiac drugs — not every dispensed item; a
  topical ointment needs no pre-dispense vitals check at all.
  Suggesting `VitalsEntryPanel` for every `DispenseMedication`
  regardless of what's being dispensed would be a blanket rule dressed
  up as a targeted safety check, not the "same claim, third real
  caller" reuse bed's and lab's own sections could honestly claim.
- **The data this distinction would need doesn't exist, on purpose.**
  `PrescriptionRecord.medicationCode` is deliberately a plain string
  with no drug-class or monitoring-requirement metadata — the same
  restraint `cdssPharmacyPlanner.ts`'s own doc comment already applies
  to not inventing which medication to prescribe in the first place.
  Building the vitals suggestion here would have meant either
  fabricating that categorization data or silently ignoring the real
  distinction it exists to protect — both worse than not building it.
- **Asked, not assumed.** Given genuine uncertainty about whether the
  gap should be closed with a coarser (and less honest) rule or left
  open, this was raised directly rather than resolved unilaterally the
  way the "is this component/tier combination genuinely new" calls in
  every prior CDSS section were — the answer here depended on a
  judgment about acceptable clinical accuracy, not just on tracing
  what already exists in the codebase.
- **What this still doesn't do: an Agent-selected UI component for
  scheduling, ledger, imaging, or nursing.** Pharmacy declining doesn't
  predict any of these either way — each remains its own open question,
  the same as before. **Scheduling has since been checked and
  accepted — see the next section.**

## Resolved: the Agent-selected UI half of the contract, proven against a fourth domain (scheduling)

`cdssSchedulingPlanner.ts`'s new `suggestVitalsEntryPanel` gives
scheduling's own CDSS rule the same `VitalsEntryPanel`-suggestion
ability lab's own section proved for lab — the fourth real caller of
the identical component.

- **This wasn't a fresh clinical judgment call the way pharmacy's was
  — it's the identical justification lab's own section already
  established, because it's the identical real-world event.**
  `SchedulingDischargeSignal` and `LabDischargeSignal` both represent a
  patient discharge, not two different events that happen to look
  similar — `patientToScheduling.ts`'s own doc comment already
  confirms the choreography reasoning "recurs" for scheduling for the
  identical reason it does for lab and imaging. "Discharge vitals," the
  real safety-check practice that justified reusing the component for
  lab, applies here with equal validity, not a stretched analogy —
  unlike pharmacy's dispense event, which needed a *different* kind of
  event to be universally vitals-relevant and didn't have one.
- **No per-instance judgment needed here either, for the same reason
  lab's didn't need one.** The suggestion is tied to the discharge
  signal itself, not to which bookings the domain's own rule happens to
  find and cancel — a discharge is a discharge regardless of what
  scheduling state it disturbs, the same "the event, not the side
  effect, is what's universal" reasoning `cdssLabPlanner.ts`'s own
  version already relies on.
- **`SchedulingDischargeSignal` gained `patientId` for the identical
  reason `LabDischargeSignal` and `BedNeedSignal` did.** The
  cancellation rule itself never reads it; only
  `suggestVitalsEntryPanel` does.
- **What this still doesn't do: an Agent-selected UI component for
  ledger, imaging, or nursing.** Three domains in a row (bed, lab,
  scheduling) finding a genuine fit is still not evidence the remaining
  three will — ledger's reversal, imaging's cancellation, and nursing's
  revocation are each their own real-world event, and pharmacy's
  decline already proved this pattern doesn't generalize
  automatically. Each remains an open question to check on its own
  terms, not to assume either way.
