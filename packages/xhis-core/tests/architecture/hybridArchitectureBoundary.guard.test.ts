import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `CLAUDE.md`'s hybrid client-server guardrails, turned into something
 * CI actually checks — the same "a compiler enforces exhaustiveness,
 * but nothing stops ambient calls... turning a convention into
 * something CI actually checks" move
 * `tests/instructions/patient/determinism.guard.test.ts` already made
 * for ambient time/randomness/IO. `docs/HYBRID_ARCHITECTURE_ALIGNMENT.md`'s
 * audit found zero hits for every pattern below at the time it was
 * written; this is what keeps that true going forward instead of
 * needing a second manual audit whenever someone wonders.
 *
 * Deliberately scoped to all of `src/`, not a narrow subdirectory —
 * unlike the determinism guard (which only needs `core/execution` and
 * `instructions`, since `core/io`/`integration` legitimately do real
 * I/O), `CLAUDE.md` states this entire repository is server-side. There
 * is no subdirectory under `src/` a client-only, hardware, or
 * database-specific import would ever be *correct* in.
 *
 * Matches import/require shapes and real API call shapes
 * (`document.foo`, `window.foo`), not bare words — `resolveUiRenderOutcome.ts`'s
 * own comment says "nothing under `src/` references `react` at all,"
 * and a naive `/react/` pattern would flag that sentence as a false
 * positive. Proven against that exact file before being trusted, the
 * same "prove it before trusting it" discipline every other guard in
 * this codebase was held to.
 */
const BANNED_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'a React import', pattern: /from\s+['"]react(-dom)?['"]/ },
  { label: 'a React require', pattern: /require\(\s*['"]react(-dom)?['"]\s*\)/ },
  { label: 'a DOM document API call', pattern: /\bdocument\.\w/ },
  { label: 'a DOM window API call', pattern: /\bwindow\.\w/ },
  { label: 'an HTTP server framework import', pattern: /from\s+['"](express|fastify|koa|hapi)['"]/ },
  {
    label: 'a database driver import',
    pattern: /from\s+['"](pg|mysql2?|mongodb|better-sqlite3|sqlite3|prisma|@prisma\/client|typeorm|knex)['"]/,
  },
  { label: 'a hardware/peripheral SDK import', pattern: /from\s+['"](serialport|node-hid|escpos|node-usb|usb)['"]/ },
];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (entry.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('hybrid architecture boundary guard', () => {
  it('src/ never imports or calls a client-only, hardware, or database-specific API — this repository is server-side only', () => {
    const guardedDir = join(process.cwd(), 'src');
    const offenders: string[] = [];

    for (const file of collectSourceFiles(guardedDir)) {
      const source = readFileSync(file, 'utf8');
      for (const { label, pattern } of BANNED_PATTERNS) {
        if (pattern.test(source)) {
          offenders.push(`${file} looks like ${label} (matched ${pattern})`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
