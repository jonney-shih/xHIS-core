import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The CI-enforced half of `CLAUDE.md`'s 4th guardrail (the Deterministic
 * Foundation/XGuard split) — the same "turn a convention into something
 * CI actually checks" move `tests/architecture/hybridArchitectureBoundary.guard.test.ts`
 * already made for the hybrid client-server boundary in `@xhis/core`
 * itself, applied here to the newer core/XGuard boundary instead.
 *
 * Two independent things are checked, in both directions:
 *
 * 1. Nothing under `packages/xguard/src` ever imports a *deep* path into
 *    `@xhis/core`'s internals (`@xhis/core/dist/...`, a relative path
 *    that reaches into `../xhis-core/src/...`, etc.) — only the
 *    package-level specifier `@xhis/core` itself, i.e. `src/index.ts`'s
 *    public export surface. This is a real constraint, not a stylistic
 *    one: `@xhis/core`'s internal module layout is free to change shape
 *    behind that seam precisely because nothing outside it is allowed
 *    to depend on the shape directly — see `docs/XGUARD_INTEGRATION.md`.
 * 2. `packages/xhis-core/src` contains zero references to `xguard` at
 *    all — the Deterministic Foundation must stay domain-agnostic and
 *    must never grow a dependency (import, string reference, anything)
 *    on the operational domain built on top of it, the same direction
 *    `CLAUDE.md`'s guardrails already required of the clinical-vs-client
 *    split.
 *
 * Scoped to all of `packages/xguard/src` and all of
 * `packages/xhis-core/src`, not narrower subdirectories — same
 * "deliberately whole-tree, not spot-checked" reasoning
 * `hybridArchitectureBoundary.guard.test.ts` gives for its own scope.
 */
const DEEP_CORE_IMPORT_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: "a deep import into '@xhis/core/...'", pattern: /from\s+['"]@xhis\/core\/[^'"]+['"]/ },
  { label: "a deep require of '@xhis/core/...'", pattern: /require\(\s*['"]@xhis\/core\/[^'"]+['"]\s*\)/ },
  // A relative path that climbs out of packages/xguard and into
  // xhis-core's own tree (however many `../` segments it takes to get
  // there) is exactly as much a boundary leak as an absolute deep
  // import — the package-level specifier above is the *only* sanctioned
  // way in.
  { label: "a relative import reaching into '../xhis-core/'", pattern: /from\s+['"][./]+xhis-core\/[^'"]+['"]/ },
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

describe('xguard/core boundary guard', () => {
  it("packages/xguard/src never imports a deep path into @xhis/core's internals -- only the package-level '@xhis/core' export", () => {
    const guardedDir = join(process.cwd(), 'src');
    const offenders: string[] = [];

    for (const file of collectSourceFiles(guardedDir)) {
      const source = readFileSync(file, 'utf8');
      for (const { label, pattern } of DEEP_CORE_IMPORT_PATTERNS) {
        if (pattern.test(source)) {
          offenders.push(`${file} looks like ${label} (matched ${pattern})`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('packages/xhis-core/src never references xguard -- the Deterministic Foundation stays domain-agnostic', () => {
    // `process.cwd()` is `packages/xguard` when this test runs (npm sets
    // it per-workspace) — reach across to the sibling package rather
    // than assuming any particular repo root path.
    const xhisCoreSrc = join(process.cwd(), '..', 'xhis-core', 'src');
    const offenders: string[] = [];

    for (const file of collectSourceFiles(xhisCoreSrc)) {
      const source = readFileSync(file, 'utf8');
      if (/xguard/i.test(source)) {
        offenders.push(`${file} references 'xguard'`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
