/**
 * Parse-time errors for the TNI v1 file format.
 * Per docs/specs/fileformat.md §"Error reporting".
 */

export interface ParseErrorLoc {
  line: number;
  col: number;
}

export class ParseError extends Error {
  readonly line: number;
  readonly col: number;
  readonly hint?: string;

  constructor(message: string, loc: ParseErrorLoc, hint?: string) {
    super(
      `line ${loc.line}, col ${loc.col}: ${message}${
        hint ? ` (did you mean '${hint}'?)` : ''
      }`,
    );
    this.name = 'ParseError';
    this.line = loc.line;
    this.col = loc.col;
    this.hint = hint;
  }
}

/**
 * Pick the closest candidate to `input` from `options` using Levenshtein
 * distance. Returns `undefined` when nothing is close enough (distance >
 * 2 + len/4).
 */
export function suggest(
  input: string,
  options: readonly string[],
): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  const threshold = 2 + Math.floor(input.length / 4);
  for (const candidate of options) {
    const d = levenshtein(input, candidate);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  if (bestDist <= threshold) return best;
  return undefined;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}
