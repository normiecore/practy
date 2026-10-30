/** Fuzzy name matching for conflict checks across every party on every matter. */

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "the"]);
const ORG_SUFFIXES = new Set(["pty", "ltd", "limited", "proprietary", "inc", "co", "company", "as", "trustee", "for"]);

export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !TITLES.has(t) && !ORG_SUFFIXES.has(t))
    .join(" ");
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - window); j < Math.min(b.length, i + window + 1); j++) {
      if (!bMatch[j] && a[i] === b[j]) {
        aMatch[i] = bMatch[j] = true;
        matches++;
        break;
      }
    }
  }
  if (!matches) return 0;
  let t = 0;
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Order-insensitive similarity ("Smith John" vs "John Smith"). */
export function nameSimilarity(a: string, b: string): number {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  const sorted = (s: string) => s.split(" ").sort().join(" ");
  return Math.max(jaroWinkler(na, nb), jaroWinkler(sorted(na), sorted(nb)));
}

export const CONFLICT_THRESHOLD = 0.9;
