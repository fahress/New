/** Fuzzy name matching used to flag possible duplicates. */
/** Edit distance, capped (only small distances matter here). */
export function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const PREFIX = /^(ht|tptq|29lt|ko|bh|fs|as|te|ms|diwan|ff|pf|ge|dt)(?=[a-z])/;
export const loose = (k: string) => k.replace(PREFIX, '').replace(/(pro|std|vf|variable|regular)$/, '');
/** Names that are probably the same thing spelled differently (not exact matches). */
export function similar(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  const la = loose(a), lb = loose(b);
  if (la.length >= 4 && la === lb) return true;
  const n = Math.min(a.length, b.length);
  return n >= 5 && lev(a, b) <= (n >= 9 ? 2 : 1);
}


