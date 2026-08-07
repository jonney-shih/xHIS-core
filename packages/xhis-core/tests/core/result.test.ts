import { describe, expect, it } from 'vitest';
import { err, flatMap, map, match, ok, type Result } from '../../src/core/execution/result.js';

describe('Result', () => {
  it('map transforms an ok value and leaves an err untouched', () => {
    expect(map(ok(2), (n) => n * 2)).toEqual(ok(4));
    expect(map(err<string, number>('boom'), (n) => n * 2)).toEqual(err('boom'));
  });

  it('flatMap chains ok results and short-circuits on err', () => {
    const succeed = (n: number) => ok<number, string>(n + 1);
    const fail = (_: number) => err<string, number>('nope');

    expect(flatMap(ok(1), succeed)).toEqual(ok(2));
    expect(flatMap(ok(1), fail)).toEqual(err('nope'));
    expect(flatMap(err<string, number>('already failed'), succeed)).toEqual(err('already failed'));
  });

  it('match dispatches to the matching branch', () => {
    const describeResult = (result: Result<number, string>) =>
      match(result, { ok: (v) => `ok:${v}`, err: (e) => `err:${e}` });

    expect(describeResult(ok(5))).toBe('ok:5');
    expect(describeResult(err('bad'))).toBe('err:bad');
  });
});
