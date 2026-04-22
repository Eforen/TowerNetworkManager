/**
 * Command-line tokenizer per docs/specs/commandline.md §"Input behavior".
 *
 * Rules:
 *   - Whitespace separated.
 *   - Double-quoted strings `"..."` are a single token; `\"`, `\\`, `\n`
 *     escapes recognized inside quotes.
 *   - Unterminated quotes parse up to end-of-input (treated as an
 *     open-quote token for live completion).
 *
 * `tokenize` returns both the decoded values and the character ranges in
 * the original buffer so the completer can replace the current token in
 * place without rebuilding the whole input.
 */

export interface Token {
  /** Decoded value (quotes stripped, escapes resolved). */
  value: string;
  /** Inclusive start index in the source buffer. */
  start: number;
  /** Exclusive end index in the source buffer. */
  end: number;
  /** True for tokens that were written inside double quotes. */
  quoted: boolean;
  /** True when the token's closing quote is missing (EOL inside quotes). */
  unterminated?: boolean;
}

export interface TokenizeResult {
  tokens: Token[];
  /**
   * Which token the caret is currently editing. `-1` when the caret is
   * in whitespace between tokens (or before any token).
   */
  activeIndex: number;
  /** True when the caret lies at the tail of the active token. */
  caretAtTokenEnd: boolean;
}

/** Plain tokenization without caret awareness. */
export function tokenize(input: string): Token[] {
  return tokenizeWithCaret(input, input.length).tokens;
}

/**
 * Tokenize and locate the token the caret is editing. `caret` is a
 * byte offset into `input`; pass `input.length` for end-of-line.
 */
export function tokenizeWithCaret(
  input: string,
  caret: number,
): TokenizeResult {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && isWhitespace(input[i])) i++;
    if (i >= input.length) break;
    tokens.push(readToken(input, i));
    i = tokens[tokens.length - 1].end;
  }
  return { tokens, ...locateCaret(tokens, caret) };
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t';
}

/**
 * Read a single token starting at `start`. A token is a contiguous run
 * of non-whitespace that may freely mix bare text with `"..."` quoted
 * segments. `--name="Casual Dweller"` is one token whose decoded value
 * is `--name=Casual Dweller`.
 */
function readToken(input: string, start: number): Token {
  let i = start;
  let value = '';
  let sawQuote = false;
  let unterminated = false;
  while (i < input.length && !isWhitespace(input[i])) {
    const ch = input[i];
    if (ch === '"') {
      sawQuote = true;
      i++;
      while (i < input.length) {
        const q = input[i];
        if (q === '\\') {
          const n = input[i + 1];
          if (n === '"') value += '"';
          else if (n === '\\') value += '\\';
          else if (n === 'n') value += '\n';
          else value += n ?? '';
          i += 2;
          continue;
        }
        if (q === '"') {
          i++;
          break;
        }
        value += q;
        i++;
      }
      if (i >= input.length && input[input.length - 1] !== '"') {
        unterminated = true;
      }
      continue;
    }
    value += ch;
    i++;
  }
  return {
    value,
    start,
    end: i,
    quoted: sawQuote,
    ...(unterminated ? { unterminated: true } : {}),
  };
}

function locateCaret(
  tokens: Token[],
  caret: number,
): { activeIndex: number; caretAtTokenEnd: boolean } {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (caret >= t.start && caret <= t.end) {
      return { activeIndex: i, caretAtTokenEnd: caret === t.end };
    }
  }
  // Caret is past the last token (trailing whitespace at EOL): treat
  // as a virtual slot that the next keystroke would create.
  if (tokens.length === 0 || caret > tokens[tokens.length - 1].end) {
    return { activeIndex: tokens.length, caretAtTokenEnd: true };
  }
  // Caret is in whitespace between existing tokens.
  return { activeIndex: -1, caretAtTokenEnd: false };
}
