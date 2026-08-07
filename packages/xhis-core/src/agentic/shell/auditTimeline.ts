import type { Kinded } from '../../core/execution/kinded.js';
import { isoTimestamp, type IsoTimestamp } from '../../core/temporal.js';
import type { HumanActionAuditRecord } from '../../human/humanActionAuditRecord.js';
import type { AuditRecord } from './auditRecord.js';

/**
 * A read-only, cross-domain, cross-path timeline entry — the shape
 * `docs/DETERMINISTIC_CORE_PATTERN.md`'s "Event bus vs. federated
 * subscription" section names but never builds: "a read-only tool that
 * reads several domains' independent logs and merge-sorts them by
 * timestamp... gets the same observability outcome without any domain
 * needing to know the tool exists." `source` is whatever label the
 * caller gives the log this entry came from (a domain name, a path
 * name, or both) — this module has no registry of domains and doesn't
 * need one, the same federated reasoning that section already applied
 * to choreography. `encounterId` is optional and deliberately never
 * extracted generically here — different domains name and shape the
 * field differently (or don't have one at all, like `ledger`/`nursing`),
 * so a caller who wants per-encounter filtering populates it themselves
 * from whichever concrete record shape they actually have; inventing a
 * generic extractor without a second real domain's shape to check it
 * against would be exactly the premature-abstraction mistake
 * `core/temporal.ts`'s `Tick` and `IsoTimestamp` both deliberately
 * avoided by waiting for a second real consumer first.
 */
export interface AuditTimelineEntry {
  readonly source: string;
  readonly recordedAt: IsoTimestamp;
  readonly summary: string;
  readonly encounterId?: string;
}

/**
 * Merges any number of already-summarized sources into one
 * chronologically ordered timeline. Sorting is a plain string compare on
 * `recordedAt`, not a `Date` construction/comparison — ISO-8601
 * timestamps in this codebase are always UTC (`Z`-suffixed) and
 * fixed-width, so lexicographic order already *is* chronological order;
 * reaching for `Date` here would add nothing but an ambient-time-shaped
 * API this module has no actual need for. Purely additive and read-only:
 * nothing about any domain's shell, audit record shape, or file layout
 * changes to make this work, matching "Event bus vs. federated
 * subscription"'s own point that observability and reacting are
 * different problems needing different mechanisms — this is the
 * observability half, still unbuilt at the time that section was
 * written.
 */
export function mergeAuditTimelines(
  ...sources: readonly (readonly AuditTimelineEntry[])[]
): readonly AuditTimelineEntry[] {
  return sources
    .flat()
    .slice()
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

/** Summarizes one `AuditRecord` (the agent path's audit shape,
 * `auditRecord.ts`) into a timeline entry. */
export function summarizeAgentAuditRecord<TInstruction extends Kinded, TEffect>(
  source: string,
  record: AuditRecord<TInstruction, TEffect>,
): AuditTimelineEntry {
  const approvalNote = record.approval ? `, approved by ${record.approval.approverId} (${record.approval.approverRole})` : '';
  const reasonsNote = record.reasons.length > 0 ? ` — ${record.reasons.join('; ')}` : '';

  return {
    source,
    recordedAt: isoTimestamp(record.recordedAt),
    summary: `[agent] ${record.commitOutcome}: ${record.proposal.instructions.length} instruction(s), Check ${record.decision.kind}${approvalNote}${reasonsNote}`,
  };
}

/** Summarizes one `HumanActionAuditRecord` (the human path's audit
 * shape, `human/humanActionAuditRecord.ts`) into a timeline entry —
 * deliberately a separate function from `summarizeAgentAuditRecord`,
 * not one function branching on shape, mirroring why
 * `HumanActionAuditRecord` is its own type rather than `AuditRecord`
 * reused with placeholder fields (see that type's own doc comment):
 * there was no proposal and no separate Check step, so nothing here
 * should read as if there were. */
export function summarizeHumanAuditRecord<TInstruction extends Kinded, TEffect>(
  source: string,
  record: HumanActionAuditRecord<TInstruction, TEffect>,
): AuditTimelineEntry {
  const actorNote = record.actor ? `, by ${record.actor.approverId} (${record.actor.approverRole})` : '';
  const reasonsNote = record.reasons.length > 0 ? ` — ${record.reasons.join('; ')}` : '';

  return {
    source,
    recordedAt: isoTimestamp(record.recordedAt),
    summary: `[human] ${record.outcome}: ${record.instructions.length} instruction(s)${actorNote}${reasonsNote}`,
  };
}
