import type { MediaMasonryItem } from "./media-masonry.js";

/** The wall's newest-first order, independent of which tiles Masonic mounts. */
export function viewerSequence(items: readonly MediaMasonryItem[]): string[] {
  return items.map((item) => item.key);
}

/** Steps stop at the ends; a missing selection has no next/previous action. */
export function step(
  sequence: readonly string[],
  key: string,
  direction: -1 | 1,
): string | null {
  const index = sequence.indexOf(key);
  return index < 0 ? null : (sequence[index + direction] ?? null);
}

/** Keep the nearest surviving neighbour in the old wall order, preferring next. */
export function resolveViewerKey(
  sequence: readonly string[],
  key: string,
  previous: readonly string[],
): string | null {
  if (sequence.includes(key)) return key;
  const index = previous.indexOf(key);
  if (index >= 0) {
    const remaining = new Set(sequence);
    for (let distance = 1; distance < previous.length; distance += 1) {
      for (const offset of [distance, -distance]) {
        const neighbour = index + offset;
        if (neighbour < 0 || neighbour >= previous.length) continue;
        const candidate = previous[neighbour];
        if (remaining.has(candidate)) return candidate;
      }
    }
  }
  return sequence[0] ?? null;
}
