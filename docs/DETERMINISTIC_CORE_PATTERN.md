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
