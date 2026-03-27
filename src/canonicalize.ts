// @edictum/openclaw — Unicode canonicalization for contract bypass prevention
//
// Attackers can bypass regex-based contracts using Unicode tricks:
// - Zero-width characters split patterns: curl\u200B | bash bypasses \bcurl\b
// - Cyrillic confusables: \u0440m looks like "rm" but doesn't match /\brm\b/
// - Decomposed forms: cafe\u0301 vs café — different byte sequences, same glyph
//
// This module canonicalizes string values before contract evaluation.

/** Zero-width and invisible characters that serve no purpose in tool args. */
const INVISIBLE_RE =
  /[\u200B\u200C\u200D\u00AD\uFEFF\u2060\u180E]/g

/**
 * Cyrillic characters that are visually identical to Latin ASCII.
 * Only the highest-confidence confusables are mapped — those where
 * the glyphs are indistinguishable in standard monospace fonts.
 */
const CONFUSABLE_MAP: Readonly<Record<string, string>> = {
  '\u0410': 'A', '\u0430': 'a', // А → A, а → a
  '\u0412': 'B', '\u0432': 'b', // В → B, в → b  (Cyrillic Ve)
  '\u0415': 'E', '\u0435': 'e', // Е → E, е → e
  '\u041A': 'K', '\u043A': 'k', // К → K, к → k
  '\u041C': 'M', '\u043C': 'm', // М → M, м → m
  '\u041D': 'H', '\u043D': 'h', // Н → H, н → h  (Cyrillic En)
  '\u041E': 'O', '\u043E': 'o', // О → O, о → o
  '\u0420': 'P', '\u0440': 'p', // Р → P, р → p  (Cyrillic Er)
  '\u0421': 'C', '\u0441': 'c', // С → C, с → c  (Cyrillic Es)
  '\u0422': 'T', '\u0442': 't', // Т → T, т → t
  '\u0423': 'Y', '\u0443': 'y', // У → Y, у → y  (Cyrillic U)
  '\u0425': 'X', '\u0445': 'x', // Х → X, х → x  (Cyrillic Kha)
}

/** Pre-built regex from CONFUSABLE_MAP keys — avoids rebuilding per call. */
const CONFUSABLE_RE = new RegExp(
  `[${Object.keys(CONFUSABLE_MAP).join('')}]`,
  'g',
)

/**
 * Canonicalize a string for contract evaluation.
 *
 * 1. NFKC normalization — collapses compatibility decompositions (ﬃ → ffi,
 *    fullwidth Ａ → A, decomposed café → café)
 * 2. Strip invisible characters — zero-width joiners/non-joiners, soft
 *    hyphens, BOM, word joiners that split regex word boundaries
 * 3. Map Cyrillic confusables to ASCII — prevents visual spoofing of
 *    command names (rм → rm, сurl → curl)
 *
 * Returns the original string if no changes were made (reference equality
 * preserved for fast-path detection).
 */
export function canonicalizeString(s: string): string {
  // NFKC is idempotent — if already NFKC, returns same string (V8 fast path)
  let result = s.normalize('NFKC')
  result = result.replace(INVISIBLE_RE, '')
  result = result.replace(CONFUSABLE_RE, (ch) => CONFUSABLE_MAP[ch] ?? ch)
  return result
}
