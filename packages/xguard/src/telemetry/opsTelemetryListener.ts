import type { TelemetryEvent, TelemetryHook } from '@xhis/core';

export interface OpsTelemetryListenerOptions {
  /** `@xhis/core`'s shared `telemetry` hook, or an independently
   * constructed one (see `createTelemetryHook`) — this listener never
   * assumes which. */
  readonly hook: TelemetryHook;
  /** Forwarded every event whose `domain` matches (or every event, if
   * `domain` is omitted) — accumulating them into
   * `agentic/planning/opsPlanner.ts`'s `OpsRemediationContext.events`
   * is the caller's job, not this listener's; see
   * `tests/integration/sandboxTimeoutRemediation.test.ts` for the
   * simplest real caller. */
  readonly onEvent: (event: TelemetryEvent) => void;
  readonly domain?: string;
}

/**
 * The seam between `@xhis/core`'s domain-agnostic telemetry and this
 * package's own planner — deliberately thin: forwarding, not planning.
 * Keeping "decide whether an event is ops-relevant" (a one-line domain
 * filter) separate from "decide what to do about it"
 * (`agentic/planning/opsPlanner.ts`'s actual rule) is the same
 * separation of concerns `@xhis/core`'s own Plan/Check/Act split
 * already draws one layer up.
 *
 * Returns the hook's own unsubscribe function unchanged — callers stop
 * listening the same way they would with `TelemetryHook.subscribe`
 * directly.
 */
export function subscribeOpsTelemetryListener(options: OpsTelemetryListenerOptions): () => void {
  const { hook, onEvent, domain } = options;

  return hook.subscribe((event) => {
    if (domain !== undefined && event.domain !== domain) {
      return;
    }
    onEvent(event);
  });
}
