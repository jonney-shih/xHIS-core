# XGuard integration: an operational domain on top of the Deterministic Foundation

This repository split into an npm workspaces monorepo — `packages/xhis-core`
(`@xhis/core`) and `packages/xguard` (`@xhis/xguard`) — so that a
non-clinical, *operational* concern (Kubernetes sandbox lifecycle
management, telemetry, self-healing) could be built as a first-class
consumer of the same deterministic Plan → Check → Act machinery every
clinical domain already uses, without either package compromising what
made the other work. This document explains why the split happened, the
seam between the two packages, how the `ops` domain instantiates the
same pattern every clinical domain does, and what's deliberately not
built yet.

## Why the split, not a new directory inside `xHIS-core`

`xHIS-core`'s whole value, from `docs/ARCHITECTURE.md` on down, is that
its execution core is domain-agnostic and has **zero runtime
dependencies** — nothing about a K8s-backed self-healing system should
ever be able to change that. Two options existed for adding an
operational domain: a new directory under the existing package (e.g.
`src/instructions/ops`), or a new sibling package. A new directory
would have worked *today*, since `ops` (like every other domain) needs
nothing `xhis-core` doesn't already offer generically — but it would
have quietly coupled `@xhis/core`'s release/dependency lifecycle to
`@xhis/xguard`'s. The moment a real `SandboxProvisioner` needs
`@kubernetes/client-node` (see "Deferred" below), that dependency would
either have to live in the same `package.json` as the deterministic
core it has nothing to do with, or the split would have to happen
later anyway, at a less convenient time, after more had been built on
top of the wrong shape.

Splitting first, before any real dependency forced the question, keeps
`@xhis/core` exactly what its own `CLAUDE.md` guardrails already
promised: usable by any future domain, clinical or not, without ever
needing to change shape — or acquire a dependency — for one.

## The seam: `@xhis/core`'s public export surface

`packages/xhis-core/src/index.ts` is the *only* thing `@xhis/xguard` (or
any future sibling package) is allowed to import from — never a deep
path into `@xhis/core`'s internals (`@xhis/core/dist/agentic/shell/act.js`,
a relative reach-around into `../xhis-core/src/...`, etc.). It
re-exports the domain-agnostic machinery every clinical domain's own
`engine.ts`/`agentic/risk/*.ts`/`agentic/verification/*.ts`/etc. is
already built from — `createEngine`, `Result`, `Kinded`,
`RiskTier`/`RiskTierRegistry`, `Verifier`/`combineVerifiers`,
`ImperativeShell`/`act`, `IdentityProvider`/`ApprovalPolicy`, the
validation-registry gate, and (new in this split) the telemetry hook —
but deliberately *not* the clinical domains themselves
(`instructions/bed`, `agentic/risk/lab`, ...), which remain real,
working *examples* of the pattern, not library code a new domain
imports from.

This boundary is CI-enforced in both directions by
`packages/xguard/tests/architecture/coreBoundary.guard.test.ts`: nothing
under `packages/xguard/src` may import a deep path into `@xhis/core`,
and nothing under `packages/xhis-core/src` may reference `xguard` at
all (a deliberately naive substring check, the same convention every
other `*.guard.test.ts` in this codebase already follows). See
`CLAUDE.md`'s 4th guardrail for the prose version of this rule.

## The telemetry hook contract

`@xhis/core` gained one new, purely additive piece to make this split
possible: `telemetry/hook.ts`'s `TelemetryHook` (`emit`/`subscribe`, no
`EventEmitter`, no dependencies) and `telemetry/types.ts`'s
`TelemetryEvent` union (`SandboxTimeoutEvent`, `HandlerExceptionEvent`,
`CommitConflictEvent`). This is how a domain-agnostic core can report
"something operationally interesting just happened" without knowing
who, if anyone, is listening, and without becoming aware that
`@xhis/xguard` — or anything else — exists.

Two things make this safe to add to code that used to have zero side
effects:

- **It's opt-in at every call site.** `core/execution/engine.ts`'s
  `execute()`/`executeSequence()` and `agentic/shell/act.ts`'s `act()`
  both take an *optional* telemetry parameter (`telemetryContext`/
  `telemetryTag`). Every pre-existing call site omits it and emits
  nothing at all — proven, not just asserted, by every prior test in
  those files still passing unchanged after this was added.
- **`recordedAt` is always caller-supplied, never an ambient clock
  read.** A `TelemetryEvent` describes something its emitter already
  knows happened at a specific moment; reading `Date.now()` inside
  `core/execution` or `agentic/shell` to fill that field would
  reintroduce exactly the non-determinism `determinism.guard.test.ts`
  exists to keep out, just for a new reason instead of an old one.

`@xhis/xguard`'s `telemetry/opsTelemetryListener.ts` subscribes to a
`TelemetryHook` (the shared `@xhis/core` singleton, or an independently
constructed one) and forwards matching events onward — a thin seam,
deliberately not where any actual remediation *decision* gets made
(that's the planner's job, see below).

## The `ops` domain's PDCA instantiation

`packages/xguard/src` follows the identical one-file-per-domain
Plan → Check → Act shape every clinical domain in `@xhis/core` already
uses (see `docs/ARCHITECTURE.md` and `docs/AGENTIC_LAYER.md`), applied
to a new closed instruction union, `OpsInstruction`
(`ReprovisionSandbox`, `CordonNode`, `RestartContainer`,
`ScaleDeployment`):

| Concern | Clinical domain equivalent | `@xhis/xguard`'s version |
| --- | --- | --- |
| Instruction union + engine | `instructions/bed/{types,engine}.ts` | `instructions/{types,engine}.ts` |
| Risk classification | `agentic/risk/bed.ts` | `policy/riskTiers.ts` |
| Approval policy | `agentic/identity/bed.ts`'s `EXAMPLE_bedApprovalPolicy` | `policy/approvalPolicy.ts`'s `EXAMPLE_opsApprovalPolicy` |
| Untrusted-plan validation | `agentic/validation/bed.ts` | `agentic/validation/ops.ts` |
| Check | `agentic/verification/bed.ts` | `agentic/verification/ops.ts` |
| Rule-based planner | `agentic/planning/cdssBedPlanner.ts` | `agentic/planning/opsPlanner.ts` |
| `ImperativeShell` | `agentic/shell/inMemoryShell.ts` (generic) | `agentic/shell/opsShell.ts` (`OpsShell`, K8s-lifecycle-specific) |

The one fully working, end-to-end path (see
`tests/integration/sandboxTimeoutRemediation.test.ts`) is: a
`SandboxTimeoutEvent`, emitted on `@xhis/core`'s telemetry hook, is
forwarded to `opsPlanner.ts`'s rule-based planner, which proposes a
`ReprovisionSandbox` instruction; that raw, still-untrusted candidate
passes through `agentic/validation/ops.ts`'s gate the same way any
LLM's raw JSON would have to; `agentic/verification/ops.ts`'s Check
accepts it at the `'auto'` risk tier (reprovisioning one sandbox is
reversible and single-resource-scoped, the same "consequence, not
mechanism, drives the tier" reasoning every clinical risk tier already
uses); and `@xhis/core`'s own `act()` commits it through `OpsShell`,
whose `commit()` calls the (for now, in-memory) `SandboxProvisioner`
and records an audit entry correlated back to the sandbox the
triggering event named.

`CordonNode`, `RestartContainer`, and `ScaleDeployment` are typed,
risk-tiered (`'auto'`/`'approval-required'`/`'review-required'`
respectively), and validated the same way — but have no planner rule
mapped to them yet, and their handlers are unconditional pass-throughs
with a `// TODO: real K8s-backed implementation` marker. That's
deliberate scoping for this slice, not an oversight: the point was to
prove the whole pipeline end to end for one concrete case, not to
pre-build remediation logic for events this system doesn't emit yet.

## What's deferred to a follow-up

None of the following exists anywhere in this workspace today, and all
of it is explicitly out of scope for this integration:

- **A real, K8s-backed `SandboxProvisioner`.** `sandbox/provisioner.ts`
  defines the interface (`reprovision`/`getStatus`); the only
  implementation is `sandbox/inMemorySandboxProvisioner.ts`, which
  tracks status in a `Map` and does nothing to any real cluster. A real
  implementation would be built against `@kubernetes/client-node` —
  deliberately not a dependency of `@xhis/xguard` yet — behind this
  same interface, so nothing above the provisioner seam (the planner,
  Check, `OpsShell`) would need to change.
- **An idle-TTL reaper.** Nothing tears down a sandbox that's `'ready'`
  and has been sitting idle; `sandbox/provisioner.ts`'s `getStatus` doc
  comment notes this is where a reaper would need to read "how long has
  this been idle" from, once one exists.
- **Resource-limit enforcement.** No cap on concurrently-provisioned
  sandboxes, no per-sandbox CPU/memory quota. A real provisioner
  implementation is where this would need to live.
- **Remediation rules for `HandlerExceptionEvent`/`CommitConflictEvent`.**
  `opsPlanner.ts` explicitly does not map either to any `OpsInstruction`
  yet — both are domain-agnostic core signals ("some proposal failed to
  execute" / "a commit lost a race"), and guessing at a remediation rule
  for either without a real, observed operational need would be
  exactly the premature-abstraction mistake this codebase's own history
  (see `docs/DETERMINISTIC_CORE_PATTERN.md`) already avoids elsewhere.
- **Real blast-radius modeling.**
  `agentic/verification/ops.ts`'s `createBlastRadiusPlaceholderVerifier`
  accepts unconditionally today; a real implementation needs actual
  cluster state (how many pods/nodes a `ScaleDeployment`/`CordonNode`
  would affect) that nothing in this package computes yet.
