import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Shared append-only JSON Lines file handling — extracted once a second
 * consumer (`outboxCursor.ts`) needed the exact same three operations
 * `agentic/shell/fileShell.ts` already had as private helpers. Not part
 * of `src/core/execution/**` — this does real I/O on purpose, so it
 * lives in its own domain-agnostic corner instead, same "core is
 * domain-agnostic and reusable" reasoning as `core/execution` itself, just
 * for infrastructure that has to touch a filesystem.
 */

export function ensureParentDirectory(file: string): void {
  const dir = dirname(file);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function appendJsonLine(file: string, value: unknown): void {
  appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');
}

export function readJsonLines<T>(file: string): readonly T[] {
  if (!existsSync(file)) {
    return [];
  }

  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

/** The last line only — the same "no separate snapshot, the last line
 * already has everything" reasoning `fileShell.ts`'s `readLatestContext`
 * relies on, generalized for reuse. */
export function readLastJsonLine<T>(file: string): T | undefined {
  const lines = readJsonLines<T>(file);
  return lines.length > 0 ? lines[lines.length - 1] : undefined;
}
