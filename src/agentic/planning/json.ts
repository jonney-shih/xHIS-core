import { err, ok, type Result } from '../../core/execution/result.js';

/**
 * LLM text responses routinely aren't *just* JSON — they arrive wrapped in
 * a markdown code fence, or with a sentence of preamble before the object.
 * Tries, in order: the whole text as-is, the contents of the first fenced
 * code block, and the substring between the first `{` and the last `}`.
 * Returns the first of those that parses. This is about tolerating
 * formatting noise, not about validating the *shape* of what comes out —
 * that's `validation/validator.ts`'s job, downstream of this.
 */
export function extractJson(text: string): Result<unknown, string> {
  const direct = tryParse(text);
  if (direct.ok) {
    return direct;
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const fromFence = tryParse(fenced[1]!);
    if (fromFence.ok) {
      return fromFence;
    }
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const fromBraces = tryParse(text.slice(start, end + 1));
    if (fromBraces.ok) {
      return fromBraces;
    }
  }

  return err('no valid JSON object found in the response');
}

function tryParse(text: string): Result<unknown, string> {
  try {
    return ok(JSON.parse(text));
  } catch {
    return err('JSON.parse failed');
  }
}
