import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Determinism is a design convention (see docs/ARCHITECTURE.md), not
 * something `tsc` can enforce. This test is the cheap, zero-dependency
 * guard for it: handlers and core execution code must receive every
 * time-/randomness-/IO-derived value through their arguments rather than
 * reaching for it themselves, or a replay of the same instructions could
 * produce a different outcome.
 */
const BANNED_PATTERNS: readonly RegExp[] = [
  /\bDate\.now\s*\(/,
  /\bnew\s+Date\s*\(/,
  /\bMath\.random\s*\(/,
  /\bfetch\s*\(/,
  /\bprocess\.env\b/,
  /from\s+['"]node:fs['"]/,
  /from\s+['"]fs['"]/,
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

describe('determinism guard', () => {
  it('core execution and instruction source never call ambient, non-deterministic APIs', () => {
    const guardedDirs = [
      join(process.cwd(), 'src', 'core', 'execution'),
      join(process.cwd(), 'src', 'instructions'),
    ];

    const offenders: string[] = [];

    for (const dir of guardedDirs) {
      for (const file of collectSourceFiles(dir)) {
        const source = readFileSync(file, 'utf8');
        for (const pattern of BANNED_PATTERNS) {
          if (pattern.test(source)) {
            offenders.push(`${file} matches ${pattern}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
