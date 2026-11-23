export const PAGE_SIZES = [10, 20, 50, 100];

/** 1 … 4 5 [6] 7 8 … 20 */
export function pageButtons(page: number, pages: number): Array<number | '…'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const center = [page - 1, page, page + 1].filter((x) => x > 1 && x < pages);
  const out: Array<number | '…'> = [1];
  if (center[0]! > 2) out.push('…');
  out.push(...center);
  if (center.at(-1)! < pages - 1) out.push('…');
  out.push(pages);
  return out;
}
