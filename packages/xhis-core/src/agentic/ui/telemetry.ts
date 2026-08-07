/**
 * A lightweight, local debug/telemetry record of one Agent UI proposal
 * — explicitly *not* a non-repudiable audit event. `agentic/shell/auditRecord.ts`'s
 * `AuditRecord` exists because MOHW/PDPA care about who committed what
 * state change; nothing here ever commits state at all — there is no Do
 * stage for a UI proposal, because there is no engine to dry-run
 * against (see `proposal.ts`'s own doc comment). This is for local
 * observability/debugging only — deliberately a separate, much smaller
 * type, not `AuditRecord` reused with placeholder fields, the same
 * "don't force a different concern into an existing audit shape"
 * reasoning `human/humanActionAuditRecord.ts`'s own doc comment already
 * applies to the human-initiated path.
 */
export interface UiProposalTelemetryEntry {
  readonly component: string;
  readonly outcome: 'rendered' | 'fallback';
  readonly reasons: readonly string[];
  readonly recordedAt: string;
}

export interface UiProposalTelemetryLog {
  record(entry: UiProposalTelemetryEntry): void;
}

/** In-memory only, on purpose — this is a debug aid for local/dev use,
 * not a durable store. Nothing has asked this to survive a restart;
 * adding that now would be solving a problem nobody has yet, the same
 * "deferred until a real need" discipline
 * docs/DETERMINISTIC_CORE_PATTERN.md applies throughout. */
export function createInMemoryUiProposalTelemetryLog(): UiProposalTelemetryLog & {
  readonly entries: readonly UiProposalTelemetryEntry[];
} {
  const entries: UiProposalTelemetryEntry[] = [];

  return {
    entries,
    record(entry) {
      entries.push(entry);
    },
  };
}
