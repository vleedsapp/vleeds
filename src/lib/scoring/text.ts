/**
 * Deterministic text matching shared by scoring (P1-E6) and contact role
 * matching (P1-E5). No fuzzy, semantic or AI matching: a phrase matches only
 * when its normalized words appear as a whole-word sequence.
 */

/** NFKC, lower-case, anything that isn't a letter/number becomes a space, whitespace collapsed. */
export const textKey = (t: string) =>
  t
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** True when `phrase` appears in `text` as whole words ("Senior Operations Manager" contains "operations manager"). */
export function containsPhrase(text: string | null | undefined, phrase: string): boolean {
  const b = textKey(phrase);
  if (!b || !text) return false;
  return ` ${textKey(text)} `.includes(` ${b} `);
}

/** Exact normalized equality. */
export const samePhrase = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && textKey(a) === textKey(b) && textKey(a) !== "";
