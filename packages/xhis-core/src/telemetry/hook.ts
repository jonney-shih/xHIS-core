import type { TelemetryEvent } from './types.js';

export type TelemetryListener = (event: TelemetryEvent) => void;

/**
 * A minimal in-process pub/sub for `TelemetryEvent`s — deliberately not
 * `node:events`' `EventEmitter` (a runtime dependency this package has
 * never needed, see `package.json`'s zero-`dependencies` discipline) and
 * deliberately not a class, matching `agentic/shell/scheduler.ts`'s own
 * plain-function-returning-an-object style rather than this codebase's
 * (rare) class-based alternative.
 *
 * `subscribe` returns an unsubscribe function rather than taking the
 * listener back on a separate `unsubscribe` call — the same ergonomic
 * shape every other "register a callback, get a cleanup function back"
 * seam in the wider Node ecosystem uses, and one this module can offer
 * for free since it owns the listener set.
 */
export interface TelemetryHook {
  emit(event: TelemetryEvent): void;
  subscribe(listener: TelemetryListener): () => void;
}

/**
 * Constructs an independent hook with its own listener set — the
 * dependency-injectable form, for tests and for any caller that wants a
 * hook that isn't the shared process-wide one below.
 */
export function createTelemetryHook(): TelemetryHook {
  const listeners = new Set<TelemetryListener>();

  return {
    emit(event) {
      // A snapshot, not a live iteration over `listeners` itself — a
      // listener that unsubscribes (its own or another's) while `emit`
      // is running must not perturb this call's delivery, the same
      // "don't let an in-flight iteration observe a structure that's
      // mutating underneath it" discipline this codebase already
      // applies to `readJsonLines`-backed stores. Never awaited and
      // never wrapped in try/catch: a throwing listener is a bug in that
      // listener, and letting it propagate is preferable to this shared,
      // dependency-free primitive silently swallowing it.
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The shared, process-wide hook `core/execution/engine.ts` and
 * `agentic/shell/act.ts` emit through — see each file's own doc comment
 * for exactly which failure paths call `telemetry.emit(...)` and why.
 * With no subscriber registered, `emit` is a no-op in every observable
 * sense (an empty loop over an empty set): existing behavior for every
 * call site that predates this module is unchanged unless something
 * actually calls `subscribe`.
 */
export const telemetry: TelemetryHook = createTelemetryHook();
