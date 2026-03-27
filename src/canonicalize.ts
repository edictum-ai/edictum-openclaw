// @edictum/openclaw — Unicode canonicalization for contract bypass prevention
//
// Attackers can bypass regex-based contracts using Unicode tricks:
// - Zero-width characters split patterns: curl\u200B | bash bypasses \bcurl\b
// - Cyrillic confusables: \u0440m looks like "rm" but doesn't match /\brm\b/
// - Bidi controls: reorder displayed text without changing code points
// - Decomposed forms: cafe\u0301 vs café — different byte sequences, same glyph
//
// This module canonicalizes string values before contract evaluation.

/**
 * Zero-width, invisible, and bidi control characters that serve no
 * purpose in tool args and can split regex word boundaries.
 *
 * Includes:
 * - U+200B–U+200D: zero-width space/joiner/non-joiner
 * - U+200E–U+200F: LRM/RLM (bidi marks)
 * - U+202A–U+202E: bidi embeddings and overrides
 * - U+00AD: soft hyphen
 * - U+FEFF: BOM / zero-width no-break space
 * - U+2060–U+2064: word joiner, invisible operators
 * - U+180E: Mongolian vowel separator
 * - U+034F: combining grapheme joiner (splits \b boundaries)
 */
const INVISIBLE_RE =
  /[\u200B\u200C\u200D\u200E\u200F\u202A\u202B\u202C\u202D\u202E\u00AD\uFEFF\u2060\u2061\u2062\u2063\u2064\u180E\u034F]/g

/**
 * Characters from non-Latin scripts that are visually identical to Latin ASCII.
 * Only the highest-confidence confusables are mapped — those where the glyphs
 * are indistinguishable in standard monospace fonts.
 *
 * Sources: Unicode Confusables dataset (https://unicode.org/Public/security/latest/confusables.txt)
 */
const CONFUSABLE_MAP: Readonly<Record<string, string>> = {
  // Cyrillic
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
  // Greek (high-confidence monospace confusables)
  '\u0391': 'A', '\u03B1': 'a', // Α → A, α → a  (Alpha)
  '\u0392': 'B', '\u03B2': 'b', // Β → B, β → b  (Beta — uppercase only in most fonts)
  '\u0395': 'E', '\u03B5': 'e', // Ε → E, ε → e  (Epsilon)
  '\u0396': 'Z', '\u03B6': 'z', // Ζ → Z          (Zeta — uppercase)
  '\u0397': 'H',                 // Η → H          (Eta — uppercase)
  '\u0399': 'I', '\u03B9': 'i', // Ι → I, ι → i  (Iota)
  '\u039A': 'K', '\u03BA': 'k', // Κ → K, κ → k  (Kappa)
  '\u039C': 'M',                 // Μ → M          (Mu — uppercase)
  '\u039D': 'N', '\u03BD': 'v', // Ν → N, ν → v  (Nu — lowercase looks like v)
  '\u039F': 'O', '\u03BF': 'o', // Ο → O, ο → o  (Omicron)
  '\u03A1': 'P', '\u03C1': 'p', // Ρ → P, ρ → p  (Rho)
  '\u03A4': 'T', '\u03C4': 't', // Τ → T          (Tau — uppercase)
  '\u03A5': 'Y', '\u03C5': 'u', // Υ → Y, υ → u  (Upsilon)
  '\u03A7': 'X', '\u03C7': 'x', // Χ → X, χ → x  (Chi)
  // Ukrainian
  '\u0406': 'I', '\u0456': 'i', // І → I, і → i  (Ukrainian I)
  '\u0404': 'E',                 // Є → E          (Ukrainian Ye — uppercase)
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
 *    hyphens, BOM, word joiners, bidi controls, combining grapheme joiner
 * 3. Map script confusables to ASCII — prevents visual spoofing of
 *    command names (Cyrillic сurl → curl, Greek υ → u)
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
