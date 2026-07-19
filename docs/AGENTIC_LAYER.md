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
- If a third-party LLM API is used, personal data transmission requires an
  entrustment contract that satisfies PDPA Enforcement Rules Article 8
  (個人資料保護法施行細則第 8 條) — scope, purpose, retention/destruction, and
  supervision terms. A vendor's generic Data Processing Agreement (DPA)
  overlaps with this but is not automatically the same thing; satisfying
  one doesn't imply satisfying the other.
- A vendor-offered U.S. HIPAA Business Associate Agreement (BAA), where
  available, is not a substitute for the above — Taiwan has no BAA concept.
  Treat it as a security-posture signal from the vendor, nothing more.
- Because this is medical record data, the entrustment contract likely also
  has to satisfy MOHW's 醫療機構電子病歷製作及管理辦法 ("Regulations Governing
  the Creation and Management of Electronic Medical Records by Medical
  Institutions," law code L0020121 — no official English translation
  exists; that rendering is common law-firm usage, not government-
  certified). Its 2022 amendment requires a written contract plus vendor
  cybersecurity-standard verification for anyone entrusted with deploying
  or managing an EMR system, and expects cloud-stored data to stay within
  Taiwan's territory — a separate, healthcare-specific bar on top of the
  general PDPA entrustment requirement above.
- Cross-border transfer of even minimized context to an overseas LLM API
  may be subject to a PDPA Article 21 restriction order for this data
  category. Unconfirmed as of this writing — needs a legal check before any
  vendor is finalized, not an assumption baked into this design.
- This layer must not assume any specific vendor is pre-cleared on any of
  the above. None of this is legal advice; route the actual vendor decision
  through counsel/DPO before Plan is ever wired to a real LLM.
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
| **Plan** | `src/agentic/planning/` + `src/agentic/validation/` | LLM proposes `RawPlanOutput` (`instructions: unknown[]`) from goal + minimized context. `toPlanProposal()` runs every candidate through the closed-union validator registry for its domain — a proposal that doesn't validate never becomes a typed `PlanProposal` and never reaches Do. |
| **Do** | existing `executeSequence` | Dry-run only. No new execution code: handlers are pure, so running a proposal speculatively is already safe. Produces `{context, effects}` or an error — nothing is applied yet. |
| **Check** | `src/agentic/verification/` | `combineVerifiers()` folds several `Verifier`s over the `PlanProposal` into one `VerifyDecision` by severity (`reject` > `needs-human-approval` > `accept`) — see `patient.ts` for the assembled example: a PDPA rationale scan, a batch-size business rule, and the risk-tier lookup. Any verifier in the combination can only ever *raise* the outcome, never lower it. A handler-raised business-rule error from Do is still a separate, harder guard enforced at Act, not here — see that row. |
| **Act** | `src/agentic/shell/` (`act()`, against an `ImperativeShell`) | Commits effects only on `accept`, or on `needs-human-approval` once an `Approval` is attached — never on `reject`, never while approval is still pending, never when Do itself failed. An `Approval` only exists once `src/agentic/identity/resolveApproval.ts` has bound the raw claim to a real, permission-checked identity — see "Identity & permission" below. Regardless of outcome, writes exactly one `AuditRecord`: the proposal (rationale, model/prompt version), Check's decision, the commit outcome, and the verified approver if any. Committed for real, on disk, by `createFileShell` — see "The persistent shell" below. |

```
Plan  --RawPlanOutput--> validateInstructions --> PlanProposal | rejected
Do    --executeSequence (dry run, pure)-->  {context, effects} | error
Check --risk tier + rules-->  accept | reject | needs-human-approval
Act   --only on accept/approved-->  commit effects + write audit record
```

## Identity & permission

`act()` takes an `Approval` — but `Approval.approverId` used to be nothing
more than a string a caller could set to anything. There was no check that
the ID was real, that whoever submitted it actually held it, or that they
were allowed to approve this kind of decision. `src/agentic/identity/`
closes that gap:

- `IdentityProvider.resolve(id)` — the seam a real identity system (SSO, an
  LDAP/AD directory, a hospital staff registry, ...) would implement.
  `createInMemoryIdentityProvider()` is a fixed-directory stand-in for
  tests, the same role `createInMemoryShell` plays for Act.
- `resolveApproval(identityProvider, requiredRoles, request)` — the only
  sanctioned way to turn a raw `ApprovalRequest` (an unverified claim) into
  an `Approval` that `act()` will honor. It resolves the claimed
  `approverId` against the provider and checks the resolved identity holds
  *any one* of `requiredRoles`, for *both* an approval and a decline — an
  unauthenticated "no" can block a legitimate action just as easily as an
  unauthenticated "yes" can force one through, so both need the same check.
  An empty `requiredRoles` fails closed (nobody is authorized), not open.
- The resulting `Approval` records the identity provider's *canonical* ID
  (not whatever string the raw request happened to use) and the *specific*
  role that matched (not the whole acceptable list) — a snapshot of what
  permission actually authorized the decision, since roles can change
  later and the audit record has to reflect what was true at the time.
- `ApprovalPolicy` (`approvalPolicy.ts`) maps each `RiskTier` to the roles
  that may resolve a decision at that tier — `patient.ts`'s
  `EXAMPLE_patientApprovalPolicy` is documentation, not a shippable
  default (see below): `review-required` accepts a `physician` or
  `charge-nurse`, `approval-required` needs a `physician`. Unlike
  `RiskTierRegistry`, this needs no mapped-type-over-generic-key trick and
  no unsafe cast to build or read — `RiskTier` is already a concrete,
  non-generic union at the point this type is used, so a plain `Record`
  already gets full exhaustiveness checking from `tsc`.
- `resolveApprovalForProposal(identityProvider, riskTierRegistry, policy,
  proposal, request)` composes the three: recomputes the proposal's
  `effectiveTier`, looks up that tier's roles in the policy, and delegates
  to `resolveApproval`. It's keyed off the proposal's risk tier alone, not
  off *which* verifier actually produced `needs-human-approval` — a
  batch-size rule and a risk-tier rule can both produce that decision, but
  there's only a per-risk-tier role requirement here, not a per-rule one.
  Still an open question whether that's the right long-term answer.

**xHIS-core ships no production-ready `ApprovalPolicy` for any domain.**
`EXAMPLE_patientApprovalPolicy`'s `EXAMPLE_` prefix is deliberate — an
import of it should read as "this is a placeholder" at the call site, not
as something safe to wire up as-is. Role taxonomies and delegation-of-
authority rules for clinical orders differ institution to institution
(and are usually already documented somewhere at each hospital, tied to
醫療法/醫師法 credentialing rules); xHIS-core has no way to know what a
given deployment's rules actually are, the same reasoning already applied
to not picking an LLM vendor or a real persistence backend. Every
deployment must supply and have reviewed its own `ApprovalPolicy` before
calling `resolveApprovalForProposal`.

One limitation worth being explicit about: nothing in the type system
stops code from hand-constructing an `Approval` literal and skipping
`resolveApproval` entirely — same as the "outer shell may only apply
effects when `executeSequence` returns `ok`" rule in docs/ARCHITECTURE.md,
this is a convention enforced by review and tests
(`tests/agentic/identity/approvalFlow.test.ts`), not something `tsc` can
check for you.

## The LLM planner

Everything above exists so this piece could be added without the rest of
the system having to trust it. `src/agentic/planning/` now has the actual
untrusted-planner path, not just the stub:

- `CompletionFn = (prompt: string) => Promise<string>` — one text-
  completion call, nothing more. No vendor SDK, no model name, no auth
  anywhere in this codebase's types. xHIS-core still has no opinion about
  which LLM vendor is used, and still doesn't resolve the PDPA/DPA/BAA/
  cross-border-transfer questions above — whoever calls `createLlmPlanner`
  supplies a `CompletionFn` backed by whatever vendor and credentials their
  own procurement/legal review actually cleared.
- `PromptBuilder<TCtx>.build(goal, context, feedback)` — turning a goal +
  context (+ any feedback from a failed prior attempt) into prompt text is
  a domain decision, not something the generic adapter should hardcode.
  `patientPromptBuilder.ts` is the concrete (illustrative, not
  authoritative) example for the patient domain: it states the closed
  instruction schema inline, and explicitly tells the model not to put
  identifiers in `rationale` — a real reduction in how often that happens,
  but a request to the model, not enforcement; `pdpaRules.ts`'s scan is
  still the actual backstop.
- `createLlmPlanner(complete, promptBuilder, modelVersion, promptVersion)`
  returns a `RawPlanner<TCtx>` — builds the prompt, calls `complete`,
  parses the response with `json.ts`'s `extractJson` (tolerates markdown
  code fences and surrounding prose — models rarely return *just* JSON),
  and checks only that the parsed shape has an `instructions` array and a
  `rationale` string. It does **not** validate individual instructions —
  that's still `toPlanProposal`'s job, one layer further down.
  `modelVersion`/`promptVersion` are fixed constructor arguments, never
  read from the response or any runtime input, per the TFDA "known,
  reviewed, closed set" restriction above.
- `planWithRetries(planner, registry, goal, context, proposedAt,
  maxAttempts)` drives the whole loop: call the planner, try
  `toPlanProposal`, and on failure feed exactly what went wrong back in as
  `feedback` for the next attempt — normalizing two different failure
  tiers (an unparseable response from `RawPlanner` itself, or a parseable
  response whose instructions fail per-field validation) into the same
  `readonly string[]` shape. Returns a `PlanProposal` on the first attempt
  that fully validates, or a `PlanningFailure` (attempt count + last
  feedback) only once every attempt is exhausted — nothing partial.

### Wiring `CompletionFn` against Azure OpenAI (illustrative)

This project already has an Azure enterprise agreement, so a real
deployment's `CompletionFn` would most likely be backed by Azure OpenAI
Service rather than a fresh contract with an AI vendor directly — same
reasoning as "The persistent shell"'s file-vs-database choice, applied to
procurement instead of storage. This belongs in whichever application
*calls* `createLlmPlanner`, not in xHIS-core — nothing below becomes a
dependency of this package, and a raw `fetch` call needs no SDK at all:

```ts
const completeViaAzureOpenAI: CompletionFn = async (prompt) => {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT; // https://<resource>.openai.azure.com
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT; // the deployment name, not the model name
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const apiVersion = '2024-XX-XX'; // pin to one reviewed version — never float to "latest"

  const response = await fetch(
    `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey! },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
    },
  );

  if (!response.ok) {
    throw new Error(`Azure OpenAI request failed: ${response.status} ${await response.text()}`);
  }

  const body = await response.json();
  return body.choices[0].message.content;
};
```

None of this resolves the things that actually gate whether it's safe to
use — those are still someone's call, not something a code snippet can
settle:

- **Which Azure region the resource is deployed in**, and whether that
  satisfies the data-residency question in "Restrictions" above. Azure
  OpenAI's regional availability changes over time — confirm current
  availability directly with Azure rather than assuming any specific
  region is available or sufficient.
- **Azure OpenAI's own Data Processing Addendum and content/abuse-
  monitoring terms**, not just whatever general Azure enterprise
  agreement already covers other services — Azure OpenAI is a distinct
  product with its own terms addendum, and the general agreement doesn't
  automatically extend the PDPA-entrustment-contract coverage
  "Restrictions" above calls for.
- `apiVersion`/`deployment` are fixed configuration here, not something a
  caller passes at runtime — same "known, reviewed, closed set"
  discipline `createLlmPlanner`'s own `modelVersion`/`promptVersion`
  arguments already hold themselves to.

`tests/agentic/planning/llmPlanningEndToEnd.test.ts` exercises the whole
chain with a fake model that hallucinates a nonexistent instruction kind on
its first attempt and produces a valid `AdmitPatient` on its second, after
seeing exactly that mistake described back to it — the same "vibe coding"
loop the intent/scope conversation that started this document was about,
now actually wired end to end, with every step in between still fully
deterministic and type-checked.

## The persistent shell

`createInMemoryShell` was always a test double. `src/agentic/shell/
fileShell.ts`'s `createFileShell` is a real one: two append-only JSON
Lines files (`commitsFile`, `auditFile`), written with `appendFileSync`.
This is the first place this codebase reads or writes an actual file, and
the first (dev-only) dependency it's ever added — `@types/node`, for
`node:fs`/`node:path`'s type declarations; there is still no *runtime*
dependency anywhere in `package.json`.

It's deliberately the simplest thing that's actually durable, not a
production-grade store — picking a real database was a bigger, more
specific commitment (which product, what schema, what ops burden) than
this codebase should make on a project's behalf, the same reasoning
behind not picking an LLM vendor or inventing a real role taxonomy. Three
things follow directly from the JSON Lines shape:

- Each `commit()` line already carries the *full* post-transition context
  (not a diff), so `readLatestContext()` just needs the last line — there
  is no separate snapshot file to keep in sync with the log.
- Reading is all-or-nothing per line: a line that fails `JSON.parse`
  throws rather than being silently skipped. Quietly dropping a
  corrupted audit record would be a worse failure than a loud crash, for
  something whose entire purpose is being a trustworthy trail.
- Writing is synchronous (`appendFileSync`), matching `ImperativeShell`'s
  synchronous `commit`/`recordAudit` signatures, and relies on a single
  `write()` syscall being atomic for data this size — there's no WAL,
  fsync tuning, or journaling story here.

What it explicitly does **not** provide — a real deployment has to layer
these on separately: retention/rotation (MOHW's multi-year, sometimes
indefinite, medical-record retention rules aren't encoded in a file
format), backup, encryption at rest, or safety against two processes
appending to the same files concurrently.

## Proposed layout

```
src/agentic/
  planning/       Plan — the only place non-determinism is allowed
  validation/     the untrusted-input gate — closed-union validators, one per domain
  risk/           RiskTierRegistry, one per domain instruction union
  verification/   Check — rules engine + risk-tier lookup
  identity/       binds a raw approval claim to a real, permission-checked identity
  shell/          Act — first concrete use of the "imperative shell" seam
```

Each domain (patient, and later orders/medications/...) gets its own risk
tier registry and, if its planning needs differ, its own planner — mirroring
how `src/instructions/patient/**` is domain-specific while
`src/core/execution/**` stays domain-agnostic.

## Minimal vertical slice — implemented

1. `RiskTier` / `RiskTierRegistry` types + `patientRiskTiers` (compiles,
   no runtime behavior yet).
2. `PlanProposal<TInstruction>` type + a hand-written (non-LLM) planner
   stub that returns a fixed proposal, so Do/Check/Act can be built and
   tested against something deterministic before any LLM is wired in.
3. A `Verifier` that implements the risk-tier lookup and always returns
   `needs-human-approval` for anything above `auto`.
4. An `__typetests__/exhaustiveness.ts` for `patientRiskTiers`, same pattern
   as the handler registry's, so the risk tier guarantee is proven the same
   way the dispatch guarantee is.
5. `act()` (`src/agentic/shell/act.ts`), the `ImperativeShell` interface it
   commits through, and `createInMemoryShell` — an in-memory stand-in for a
   real shell, so Act's decision logic (commit vs. reject vs. await
   approval) is exercised end to end in tests without a database.
6. `src/agentic/validation/`: an `InstructionValidatorRegistry` (the same
   totality trick as `HandlerRegistry` and `RiskTierRegistry`, a third time
   — see docs/ARCHITECTURE.md), `patientInstructionValidators`, and
   `toPlanProposal()`, which is now the *only* way a `PlanProposal` gets
   constructed from something that isn't already known-good TypeScript.
   Rejects unknown `kind`s, non-object candidates, and per-field shape
   problems, and reports every issue found across a batch rather than just
   the first.
7. `combineVerifiers()` (severity-ordered merge of any number of
   `Verifier`s, with reasons concatenated on a tie) plus two concrete rules:
   `createMaxBatchSizeVerifier()` (a business rule Do can't express — batch
   size is a property of the whole proposal, not any one instruction) and
   `createRationalePiiScanVerifier()` (a PDPA rule: heuristically rejects a
   proposal whose free-text `rationale` looks like it contains a Taiwan
   National ID or mobile number — `instructions` is already schema-
   constrained by the validator, so `rationale` is the one field an LLM
   could otherwise leak raw identifiers through into a persisted audit
   record). `patient.ts` assembles all three (PDPA scan, batch size, risk
   tier) into `patientVerifier`, the Check a real Plan/Do/Act wiring would
   actually use for this domain.
8. `src/agentic/identity/`: `IdentityProvider` + `createInMemoryIdentityProvider`,
   `resolveApproval()` — the only sanctioned way to turn a raw
   `ApprovalRequest` into an `Approval`, binding `approverId` to a real,
   role-checked identity instead of trusting whatever string a caller
   supplies — plus `ApprovalPolicy` and `resolveApprovalForProposal()`,
   which derive *which* roles are required from the proposal's own risk
   tier instead of making every caller decide that themselves. See
   "Identity & permission" above.
9. `src/agentic/planning/`: `CompletionFn` + `PromptBuilder<TCtx>` +
   `createLlmPlanner()` (a vendor-agnostic adapter around one text-
   completion call), `json.ts`'s `extractJson()` (tolerates markdown
   fences and prose around the JSON a model actually returns), and
   `planWithRetries()` (drives up to N attempts, feeding each attempt's
   parse/validation problems back as `feedback` for the next). See
   "The LLM planner" above.
10. `src/agentic/shell/fileShell.ts`: `createFileShell()`, a real (not
    in-memory) `ImperativeShell` backed by two append-only JSON Lines
    files, plus `readCommits()`/`readAuditLog()`/`readLatestContext()` to
    read them back. See "The persistent shell" above.

This gets a real Plan→Do→Check→Act path running end to end, entirely
deterministic except for the one call to `CompletionFn` that Plan itself
was always meant to isolate, against `tests/agentic/shell/act.test.ts`'s
scenarios (accept, reject, awaiting approval, approved, declined, Do
itself failing), `tests/agentic/planning/*.test.ts`'s (JSON extraction from
fenced/prose-wrapped text, a fake model's hallucinated instruction kind
recovered on retry via `llmPlanningEndToEnd.test.ts`, and exhausting every
attempt without ever producing a proposal), `tests/agentic/verification/
*.test.ts`'s (merge semantics, batch-size threshold, PII-shaped rationale,
and the assembled `patientVerifier` letting a PDPA rejection override what
risk tier alone would only send to human approval), and
`tests/agentic/identity/*.test.ts`'s (unknown identity, known identity
holding none of the required roles, any-of-several-roles, fail-closed on an
empty role list, the tier-driven policy giving `AdmitPatient` and
`DischargePatient` different acceptable roles, and — in
`approvalFlow.test.ts` — the full composition with `act()`, including an
impersonation attempt that never produces an `Approval` at all), and
`tests/agentic/shell/fileShell*.test.ts`'s (persistence across reads,
ordering, directory creation, empty-file handling, throwing on a
corrupted line, and `act()` running against the file shell exactly the
way it runs against the in-memory one). Every item originally listed in
this document as "still not done" is now implemented — see the new open
questions below for what remains genuinely undecided (an actual LLM
vendor, the file shell's retention/backup/concurrency story, and who
signs off on any of this) rather than merely unbuilt.

## Open questions for review

- `resolveApprovalForProposal()` now binds `Approval.approverId` to a real,
  role-checked identity and derives the required roles from `ApprovalPolicy`
  keyed by risk tier (see "Identity & permission" above) — and
  `EXAMPLE_patientApprovalPolicy` is now clearly named as a placeholder,
  not a shippable default, since xHIS-core targets multiple hospital
  deployments and has no way to know any one institution's real
  credentialing rules. But *who is authorized to define or change a real
  deployment's policy* is itself still undesigned — there's no approval
  process for the approval process, just a required, un-defaulted
  parameter.
- The policy is keyed by risk tier only, not by *which* verifier produced
  `needs-human-approval` — a batch-size flag and a risk-tier flag both
  require the same roles today. Worth revisiting if a rule ever needs a
  different bar (e.g. "any reviewer can clear an oversized-but-otherwise-
  fine batch, but only a physician can clear a leaked-PII rejection" — note
  the PDPA rule currently `reject`s outright rather than asking for
  approval at all, precisely to avoid this case).
- Does the audit record for agentic proposals live in the same store as
  effects from human-initiated instructions, or a separate one that's
  cross-referenced? `createFileShell` doesn't resolve this — it's a
  reference implementation for the agentic layer specifically, not a
  design for where the *whole* system's audit trail lives. Affects how
  "one audit trail" claims hold up under an MOHW review.
- `createFileShell` has no retention/rotation, backup, encryption-at-rest,
  or multi-writer story (see "The persistent shell" above) — all
  operational decisions a real deployment has to make, not something this
  reference implementation should guess at. Someone still has to decide
  where these files actually live and who's responsible for them.
- Should `auto`-tier proposals still require *any* rule to pass before Act,
  or is `auto` reserved only for instructions with no side effects at all
  (e.g. a future read-only query instruction)? This document assumes the
  latter but doesn't commit any instruction to `auto` yet.
- The platform is leaning Azure OpenAI (existing enterprise agreement —
  see "Wiring `CompletionFn` against Azure OpenAI" above), but the actual
  resource region, model deployment, and Azure OpenAI's own Data
  Processing Addendum review are all still open. `CompletionFn` makes the
  vendor a runtime injection rather than a code change, but the
  PDPA/MOHW-entrustment/DPA/cross-border-transfer questions in
  "Restrictions" above still need answers *before* any pick is wired to
  real patient context, not after.
- `modelVersion`/`promptVersion` are constructor arguments to
  `createLlmPlanner`, so a version bump is a code change rather than
  something silently swappable at runtime — but there's no defined review
  or sign-off process for *making* that code change. The TFDA restriction
  says the set must be "known, reviewed, closed"; this only gets the
  "closed" part for free from the code shape. "Reviewed" is still a
  process someone has to define.
- `patientPromptBuilder` serializes the whole `context.encounters` map
  into the prompt — fine while `PatientContext` only carries IDs and
  timestamps, not fine the moment a richer clinical domain adds anything
  more sensitive. Nothing currently enforces that a future prompt builder
  actually minimizes; it's on whoever writes that prompt builder to do it,
  same as it's on `patientPromptBuilder` today.
