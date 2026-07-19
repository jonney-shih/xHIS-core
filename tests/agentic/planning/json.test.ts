import { describe, expect, it } from 'vitest';
import { extractJson } from '../../../src/agentic/planning/json.js';

describe('extractJson', () => {
  it('parses a plain JSON object as-is', () => {
    expect(extractJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('parses JSON wrapped in a markdown code fence', () => {
    const text = 'Here you go:\n```json\n{"a":1}\n```\nHope that helps!';
    expect(extractJson(text)).toEqual({ ok: true, value: { a: 1 } });
  });

  it('parses JSON wrapped in an unlabeled code fence', () => {
    const text = '```\n{"a":1}\n```';
    expect(extractJson(text)).toEqual({ ok: true, value: { a: 1 } });
  });

  it('extracts a JSON object embedded in surrounding prose', () => {
    const text = 'Sure, here is the plan: {"a":1} — let me know if you need changes.';
    expect(extractJson(text)).toEqual({ ok: true, value: { a: 1 } });
  });

  it('fails on text with no JSON object at all', () => {
    const result = extractJson('I cannot help with that request.');
    expect(result.ok).toBe(false);
  });

  it('fails on malformed braces that still contain no valid JSON', () => {
    const result = extractJson('{not: valid, json}');
    expect(result.ok).toBe(false);
  });
});
