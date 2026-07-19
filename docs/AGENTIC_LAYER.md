# The agentic layer: AI-assisted planning over a deterministic core

This document proposes the design for an **agentic layer**: a component that
uses an LLM to plan multi-step sequences of `Instruction`s against goals or
clinical/administrative context, while never weakening the guarantees
described in [`ARCHITECTURE.md`](ARCHITECTURE.md). It is a proposal for
review, not yet implemented.

## Why this needs its own document

The static execution core buys two properties: **auditability** (every state
change is "instruction X applied to context Y produced effects Z, nothing
else") and **exact replay**. An LLM is neither deterministic nor replayable.
The entire design problem of the agentic layer is: *how do we let an LLM
propose action without ever letting it become the thing that decides what
actually happened to a patient's record.*

The answer this document proposes: **the agent only ever produces a
proposal**. Every proposal is validated back into the closed `Instruction`
type before it can touch the engine, dry-run through the existing pure
`executeSequence`, checked against risk-tiered rules, and — only past that
gate — committed by an imperative shell that writes the same kind of
immutable, JSON-serializable audit record the core already produces for
everything else. The agent never gets I/O. It never gets to define what an
instruction is. It never gets to skip the checks that apply to a human
operator doing the same thing.

## Intent & scope

**Intent**: given a goal or clinical/administrative situation expressed in
natural language, plan a candidate sequence of `Instruction`s, and route that
sequence through the existing deterministic engine and a new verification
gate before anything is committed.

**In scope**:
- The Plan step: the LLM reasons freely and proposes candidate instruction
  sequences. This is the *only* place non-determinism is allowed to enter the
  system.
- Dry-running proposals through the existing `executeSequence` — no new
  execution machinery, because handlers are already pure and safe to run
  speculatively.
- A verification/rules layer that checks proposals against business rules,
  data-handling rules, and risk tier before anything is committed.
- A human-approval path for anything the risk tier or rules engine flags.

**Out of scope, deliberately, for this iteration**:
- The agent does not define new `Instruction` kinds or modify the handler
  registry. That is a compile-time, human-reviewed activity, not something a
  runtime agent does.
- The agent has no direct I/O: no database writes, no notifications, no
  external API calls. That remains the imperative shell's job, same as today.
- The agent cannot bypass the exhaustiveness or determinism guards described
  in `ARCHITECTURE.md`. Nothing about this layer gets an exemption from those
  rules.
- Fully autonomous commit (agent proposal → effect, with no gate at all) is
  not supported by this design, for any instruction, at any risk tier. The
  lowest tier still passes through the Check step; it just doesn't require a
  *human* at that step.

## Restrictions

These are hard constraints, driven directly by the regulatory context this
core exists to serve.

### PDPA (Personal Data Protection Act)

- Context handed to the LLM during Plan must be minimized/de-identified to
  what planning actually requires — never the full record by default.
- If a third-party LLM API is used, personal data transmission requires a
  documented legal basis and a data processing agreement with the vendor.
  This layer must not assume any specific vendor is pre-cleared.
- Every Plan output retains its rationale (why the agent proposed this
  sequence) as a durable, replayable record — the same discipline the core
  already applies to effects, extended to *why*, not just *what*.

### MOHW electronic medical record / audit trail requirements

- Every committed proposal produces a non-repudiable audit record: which
  agent/model version/prompt version, on what input, proposed what, who (or
  what rule) approved it, and when.
- High-risk instructions default to requiring human approval before Act,
  regardless of what the rules engine concludes. An agent is never the sole
  authority for those.

### TFDA

- If a proposal's planning step materially influences clinical decisions,
  this layer's classification (is it Clinical Decision Support / SaMD-
  adjacent?) needs an explicit risk assessment before deployment, not an
  implicit one.
- Model and prompt versions in use must be a known, reviewed, closed set —
  the same "closed set, not runtime-configurable" discipline the core
  applies to instructions. A user must not be able to swap models or system
  prompts without that change being tracked as a version change.

## Risk tiers: a total, compiler-checked registry

The core already has one compile-time-enforced total mapping —
`HandlerRegistry`, over `Instruction['kind']`. The agentic layer adds a
second one, in the same style, so that forgetting to classify a new
instruction's risk is a type error, not a missed line in a design doc:

```ts
// src/agentic/risk/tiers.ts
export type RiskTier = 'auto' | 'review-required' | 'approval-required';

export type RiskTierRegistry<TInstruction extends Kinded> = {
  readonly [K in TInstruction['kind']]: RiskTier;
};
```

Applied to the existing patient instructions:

```ts
export const patientRiskTiers = {
  AdmitPatient: 'review-required',
  DischargePatient: 'approval-required',
} satisfies RiskTierRegistry<PatientInstruction>;
```

`AdmitPatient` is correctable and lower-consequence; `DischargePatient` is
terminal for the encounter and carries direct MOHW record-completeness and
legal weight. Any new instruction (medication orders, lab orders, ...) must
be assigned a tier in the same literal or the build fails — exactly the same
enforcement mechanism as handler-registry exhaustiveness, applied to risk
instead of dispatch.

A sequence's effective tier is the highest tier of any instruction it
contains — one `approval-required` instruction in a batch is enough to gate
the whole batch.

## PDCA mapped onto the existing architecture

| PDCA | Module | What happens |
|---|---|---|
| **Plan** | `src/agentic/planning/` | LLM proposes `Instruction[]` from goal + minimized context. Raw output is untrusted text/JSON until it passes runtime validation against the closed `Instruction` union — a proposal that doesn't validate never becomes a typed `PlanProposal` and never reaches Do. |
| **Do** | existing `executeSequence` | Dry-run only. No new execution code: handlers are pure, so running a proposal speculatively is already safe. Produces `{context, effects}` or an error — nothing is applied yet. |
| **Check** | `src/agentic/verification/` | Runs business rules (including whatever error the handler itself would raise), data-handling rules (PDPA minimization actually respected), and a risk-tier lookup. Outcome is `accept`, `reject`, or `needs-human-approval`. Risk tier can only ever *raise* the outcome toward requiring approval, never lower it. |
| **Act** | `src/agentic/shell/` (the imperative shell `ARCHITECTURE.md` flags as not yet built) | Commits effects only on `accept` (or after human approval), and — regardless of outcome — writes one audit record: rationale, model/prompt version, Check result, approver identity if any. Nothing is applied on reject, mirroring the existing all-or-nothing batch contract. |

```
Plan  --PlanProposal (untyped until validated)-->
Do    --executeSequence (dry run, pure)-->  {context, effects} | error
Check --risk tier + rules-->  accept | reject | needs-human-approval
Act   --only on accept/approved-->  commit effects + write audit record
```

## Proposed layout

```
src/agentic/
  planning/       Plan — the only place non-determinism is allowed
  risk/           RiskTierRegistry, one per domain instruction union
  verification/   Check — rules engine + risk-tier lookup
  shell/          Act — first concrete use of the "imperative shell" seam
```

Each domain (patient, and later orders/medications/...) gets its own risk
tier registry and, if its planning needs differ, its own planner — mirroring
how `src/instructions/patient/**` is domain-specific while
`src/core/execution/**` stays domain-agnostic.

## Suggested minimal first slice

1. `RiskTier` / `RiskTierRegistry` types + `patientRiskTiers` (compiles,
   no runtime behavior yet).
2. `PlanProposal<TInstruction>` type + a hand-written (non-LLM) planner
   stub that returns a fixed proposal, so Do/Check/Act can be built and
   tested against something deterministic before any LLM is wired in.
3. A `Verifier` that only implements the risk-tier lookup (no business/PDPA
   rules yet) and always returns `needs-human-approval` for anything above
   `auto`.
4. An `__typetests__/exhaustiveness.ts` for `patientRiskTiers`, same pattern
   as the handler registry's, so the risk tier guarantee is proven the same
   way the dispatch guarantee is.

This gets a real Plan→Do→Check→Act path end to end, entirely deterministic,
before introducing the one genuinely non-deterministic component (the LLM
planner itself).

## Open questions for review

- Who is the "approver" for `needs-human-approval` in practice — a
  clinician, a specific role, anyone with a permission? This layer assumes
  an identity exists to attach to the audit record; it doesn't design that
  identity/permission system.
- Does the audit record for agentic proposals live in the same store as
  effects from human-initiated instructions, or a separate one that's
  cross-referenced? Affects how "one audit trail" claims hold up under an
  MOHW review.
- Should `auto`-tier proposals still require *any* rule to pass before Act,
  or is `auto` reserved only for instructions with no side effects at all
  (e.g. a future read-only query instruction)? This document assumes the
  latter but doesn't commit any instruction to `auto` yet.
